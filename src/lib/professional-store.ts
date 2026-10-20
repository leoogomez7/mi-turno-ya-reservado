import { BARBERS, SERVICES, type Service, BUSINESS } from "./salon-data";
import { parseISO } from "date-fns";

export interface ProfessionalService {
  id: string;
  name: string;
  duration: number;
  price: number;
}

export interface ProfessionalScheduleDate {
  date: string; // yyyy-MM-dd
  start: string;
  end: string;
}

export function getScheduleForDate(professional: Professional, date: Date) {
  const target = date.toISOString().slice(0, 10);
  return professional.scheduleDates?.find((entry) => entry.date === target);
}

export function getUpcomingScheduleDates(professional: Professional) {
  const today = new Date();
  return (professional.scheduleDates ?? [])
    .map((entry) => ({
      ...entry,
      parsed: parseISO(entry.date),
    }))
    .filter((entry) => !Number.isNaN(entry.parsed.getTime()) && entry.parsed >= today)
    .sort((a, b) => a.parsed.getTime() - b.parsed.getTime());
}

export function generateSlotsFromSchedule(scheduleDay: ProfessionalScheduleDate) {
  const startMatch = scheduleDay.start.match(/^(\d{2}):(\d{2})$/);
  const endMatch = scheduleDay.end.match(/^(\d{2}):(\d{2})$/);
  if (!startMatch || !endMatch) return [];

  let current = Number(startMatch[1]) * 60 + Number(startMatch[2]);
  const end = Number(endMatch[1]) * 60 + Number(endMatch[2]);
  if (current >= end) return [];

  const slots: string[] = [];
  while (current + 30 <= end) {
    slots.push(`${String(Math.floor(current / 60)).padStart(2, "0")}:${String(current % 60).padStart(2, "0")}`);
    current += 30;
  }
  return slots;
}

export function getAvailableSlotsForDate(professional: Professional, date: Date) {
  const scheduleDay = getScheduleForDate(professional, date);
  if (scheduleDay) {
    return generateSlotsFromSchedule(scheduleDay);
  }
  return professional.availableSlots;
}

export interface Professional {
  id: string;
  name: string;
  specialty: string;
  address?: string;
  availableSlots: string[];
  services: ProfessionalService[];
  scheduleDates?: ProfessionalScheduleDate[];
  isTest?: boolean;
}

const KEY = "salon_professionals_v1";

function normalizeSlot(slot: string): string {
  const trimmed = slot.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return trimmed;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(mins) || hours < 0 || hours > 23 || mins < 0 || mins > 59) {
    return trimmed;
  }
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function read(): Professional[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null") ?? [];
  } catch {
    return [];
  }
}

function write(list: Professional[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("professionals:changed"));
}

function parseSlots(raw: string): string[] {
  return Array.from(new Set(raw
    .split(/[,\n]+/)
    .map(normalizeSlot)
    .filter((slot) => /^\d{2}:\d{2}$/.test(slot))
  )).sort();
}

const PROFESSIONAL_ADDRESSES: Record<string, string> = {
  peluquero: "Av. Corrientes 1234, CABA",
  medico: "Córdoba 5678, CABA",
};

function createDefaultProfessional(barberId: string) {
  const barber = BARBERS.find((b) => b.id === barberId);
  if (!barber) return undefined;

  const defaultServiceIdsByProfessional: Record<string, string[]> = {
    peluquero: [
      "corte-clasico",
      "fade",
      "degradado",
      "tijera",
      "barba",
      "perfilado",
      "afeitado",
      "lavado",
      "peinado",
    ],
    medico: [
      "consulta-general",
      "control-medico",
      "seguimiento",
    ],
  };

  const serviceIds = defaultServiceIdsByProfessional[barber.id] ?? SERVICES.map((service) => service.id);

  return {
    id: barber.id,
    name: barber.name,
    specialty: barber.specialty,
    address: PROFESSIONAL_ADDRESSES[barber.id] ?? BUSINESS.address,
    availableSlots: Array.from({ length: 22 }, (_, index) => {
      const hour = 8 + Math.floor(index / 2);
      const minute = index % 2 === 0 ? "00" : "30";
      return `${String(hour).padStart(2, "0")}:${minute}`;
    }).filter((slot) => slot >= "09:00" && slot <= "19:30"),
    services: serviceIds.map((serviceId) => {
      const service = SERVICES.find((s) => s.id === serviceId);
      return {
        id: service?.id ?? serviceId,
        name: service?.name ?? serviceId,
        duration: service?.duration ?? 30,
        price: service?.price ?? 0,
      };
    }),
    isTest: true,
  };
}

function getDefaultProfessionals(): Professional[] {
  return BARBERS.map((barber) => createDefaultProfessional(barber.id)).filter(Boolean) as Professional[];
}

const FIXED_PROFESSIONALS = getDefaultProfessionals();
const FIXED_IDS = new Set(FIXED_PROFESSIONALS.map((professional) => professional.id));

function isFixedProfessional(id: string) {
  return FIXED_IDS.has(id);
}

export const professionalStore = {
  all(): Professional[] {
    const saved = read();
    if (saved.length === 0) return FIXED_PROFESSIONALS;

    const savedMap = new Map(saved.map((professional) => [professional.id, professional]));
    const merged = FIXED_PROFESSIONALS.map((professional) => savedMap.get(professional.id) ?? professional);
    const extras = saved.filter((professional) => !FIXED_IDS.has(professional.id));
    return [...merged, ...extras];
  },
  add(professional: Omit<Professional, "id">) {
    const list = read();
    const existingIds = new Set(list.map((p) => p.id));
    for (const fixedId of FIXED_IDS) {
      existingIds.add(fixedId);
    }
    let id = professional.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || crypto.randomUUID();
    if (existingIds.has(id)) {
      id = crypto.randomUUID();
    }
    const newProfessional: Professional = { id, ...professional };
    write([...list.filter((p) => p.id !== id), newProfessional]);
    return newProfessional;
  },
  update(id: string, patch: Partial<Omit<Professional, "id">>) {
    write(read().map((p) => (p.id === id ? { ...p, ...patch } : p)));
  },
  remove(id: string) {
    if (isFixedProfessional(id)) return;
    write(read().filter((p) => p.id !== id));
  },
  get(id: string) {
    return this.all().find((p) => p.id === id);
  },
  parseSlots,
};

export function getProfessional(id: string) {
  return professionalStore.get(id);
}

export function getProfessionalService(professionalId: string, serviceId: string) {
  const professional = getProfessional(professionalId);
  const service = professional?.services.find((s) => s.id === serviceId);
  if (service) return service;
  return SERVICES.find((s) => s.id === serviceId);
}

export function getProfessionalServiceList(professionalId: string) {
  return getProfessional(professionalId)?.services ?? [];
}

export function sumProfessionalDuration(professionalId: string, ids: string[]) {
  return ids.reduce((sum, id) => sum + (getProfessionalService(professionalId, id)?.duration ?? 0), 0);
}

export function sumProfessionalPrice(professionalId: string, ids: string[]) {
  return ids.reduce((sum, id) => sum + (getProfessionalService(professionalId, id)?.price ?? 0), 0);
}
