import { format, getDay, parseISO } from "date-fns";
import { getCloudRecords, getCurrentStoreCode, isCloudInitialized, persistCloudCollection } from "./cloud-sync";

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
  closed?: boolean;
}

export interface ProfessionalWeeklySchedule {
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  closed: boolean;
  start: string;
  end: string;
}

export function getScheduleForDate(professional: Professional, date: Date) {
  const target = format(date, "yyyy-MM-dd");
  const override = professional.scheduleDates?.find((entry) => entry.date === target);
  if (override) return override;
  if (professional.weeklySchedule?.length) {
    const weekly = professional.weeklySchedule.find((entry) => entry.dayOfWeek === getDay(date));
    return {
      date: target,
      start: weekly?.start ?? "",
      end: weekly?.end ?? "",
      closed: !weekly || weekly.closed,
    };
  }
  return undefined;
}

export function hasScheduleConfiguration(professional: Professional) {
  return Boolean(professional.weeklySchedule?.length || professional.scheduleDates?.length);
}

export function isProfessionalAvailableOnDate(professional: Professional, date: Date) {
  const schedule = getScheduleForDate(professional, date);
  if (schedule) return !schedule.closed && generateSlotsFromSchedule(schedule).length > 0;
  if (hasScheduleConfiguration(professional)) return false;
  return professional.availableSlots.length > 0;
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
    return scheduleDay.closed ? [] : generateSlotsFromSchedule(scheduleDay);
  }
  return professional.availableSlots;
}

export interface Professional {
  id: string;
  storeCode?: string;
  name: string;
  specialty: string;
  address?: string;
  availableSlots: string[];
  services: ProfessionalService[];
  scheduleDates?: ProfessionalScheduleDate[];
  weeklySchedule?: ProfessionalWeeklySchedule[];
  isTest?: boolean;
}

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
  if (isCloudInitialized()) return getCloudRecords("professionals");
  return [];
}

async function write(list: Professional[]) {
  await persistCloudCollection("professionals", list);
  window.dispatchEvent(new Event("professionals:changed"));
}

function parseSlots(raw: string): string[] {
  return Array.from(new Set(raw
    .split(/[,\n]+/)
    .map(normalizeSlot)
    .filter((slot) => /^\d{2}:\d{2}$/.test(slot))
  )).sort();
}

export const professionalStore = {
  all(): Professional[] {
    return read();
  },
  async add(professional: Omit<Professional, "id">) {
    const list = read();
    const existingIds = new Set(list.map((p) => p.id));
    let id = professional.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || crypto.randomUUID();
    if (existingIds.has(id)) {
      id = crypto.randomUUID();
    }
    const newProfessional: Professional = { id, storeCode: getCurrentStoreCode(), ...professional };
    await write([...list.filter((p) => p.id !== id), newProfessional]);
    return newProfessional;
  },
  async update(id: string, patch: Partial<Omit<Professional, "id">>) {
    const list = read();
    if (!list.some((professional) => professional.id === id)) throw new Error("No encontramos ese profesional.");
    await write(list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  },
  async remove(id: string) {
    await write(read().filter((p) => p.id !== id));
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
  return professional?.services.find((s) => s.id === serviceId);
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
