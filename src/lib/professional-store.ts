import { BARBERS, SERVICES, type Service } from "./salon-data";

export interface ProfessionalService {
  id: string;
  name: string;
  duration: number;
  price: number;
}

export interface ProfessionalScheduleDay {
  day: number; // 0 = Sunday, 6 = Saturday
  active: boolean;
  start: string;
  end: string;
}

export interface WeeklySchedule {
  weekOffset: number;
  days: ProfessionalScheduleDay[];
}

export interface Professional {
  id: string;
  name: string;
  specialty: string;
  availableSlots: string[];
  services: ProfessionalService[];
  weeklySchedule?: WeeklySchedule[];
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

function createDefaultProfessional(barberId: string) {
  const barber = BARBERS.find((b) => b.id === barberId);
  if (!barber) return undefined;
  return {
    id: barber.id,
    name: barber.name,
    specialty: barber.specialty,
    availableSlots: Array.from({ length: 22 }, (_, index) => {
      const hour = 8 + Math.floor(index / 2);
      const minute = index % 2 === 0 ? "00" : "30";
      return `${String(hour).padStart(2, "0")}:${minute}`;
    }).filter((slot) => slot >= "09:00" && slot <= "19:30"),
    services: SERVICES.map((service) => ({
      id: service.id,
      name: service.name,
      duration: service.duration,
      price: service.price,
    })),
  };
}

function getDefaultProfessionals(): Professional[] {
  return BARBERS.map((barber) => createDefaultProfessional(barber.id)).filter(Boolean) as Professional[];
}

export const professionalStore = {
  all(): Professional[] {
    const saved = read();
    return saved.length > 0 ? saved : getDefaultProfessionals();
  },
  add(professional: Omit<Professional, "id">) {
    const list = read();
    const id = professional.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || crypto.randomUUID();
    const newProfessional: Professional = { id, ...professional };
    write([...list.filter((p) => p.id !== id), newProfessional]);
    return newProfessional;
  },
  update(id: string, patch: Partial<Omit<Professional, "id">>) {
    write(read().map((p) => (p.id === id ? { ...p, ...patch } : p)));
  },
  remove(id: string) {
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
