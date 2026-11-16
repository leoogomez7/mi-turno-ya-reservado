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
  capacity?: number;
}

export interface ProfessionalWeeklySchedule {
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  closed: boolean;
  start: string;
  end: string;
  capacity?: number;
}

export function getScheduleForDate(professional: Professional, date: Date) {
  const target = format(date, "yyyy-MM-dd");
  const override = professional.scheduleDates?.find((entry) => entry.date === target);
  const weekly = professional.weeklySchedule?.find((entry) => entry.dayOfWeek === getDay(date));
  if (override) return { ...override, capacity: override.capacity ?? weekly?.capacity ?? 1 };
  if (professional.weeklySchedule?.length) {
    return {
      date: target,
      start: weekly?.start ?? "",
      end: weekly?.end ?? "",
      closed: !weekly || weekly.closed,
      capacity: weekly?.capacity ?? 1,
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
  while (current + 15 <= end) {
    slots.push(`${String(Math.floor(current / 60)).padStart(2, "0")}:${String(current % 60).padStart(2, "0")}`);
    current += 15;
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

function read(): Professional[] {
  if (isCloudInitialized()) return getCloudRecords("professionals");
  return [];
}

async function write(list: Professional[]) {
  await persistCloudCollection("professionals", list);
  window.dispatchEvent(new Event("professionals:changed"));
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

