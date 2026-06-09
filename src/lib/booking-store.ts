import { SERVICES } from "./salon-data";
import { getProfessional as findProfessional, getProfessionalService } from "./professional-store";

export interface Customer {
  fullName: string;
  phone: string;
  email: string;
  birthday?: string;
  paymentMethod?: "efectivo" | "transferencia" | "tarjeta de crédito" | "tarjeta de débito";
  notes?: string;
  hairType?: "corto" | "medio" | "largo";
}

export interface Booking {
  id: string;
  customer: Customer;
  barberId: string;
  serviceIds: string[];
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  duration: number;
  totalPrice: number;
  status: "confirmed" | "cancelled" | "completed" | "no-show";
  createdAt: string;
  isTest?: boolean;
}

const KEY = "salon_bookings_v1";

function getSeedDate(daysAhead: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

const FIXED_BOOKINGS: Booking[] = [
  {
    id: "seed-test-booking-1",
    customer: {
      fullName: "Cliente de prueba",
      phone: "+54 9 11 1234 5678",
      email: "prueba@turno.com",
    },
    barberId: "peluquero",
    serviceIds: ["corte-clasico", "barba"],
    date: getSeedDate(2),
    time: "15:00",
    duration: 55,
    totalPrice: 14000,
    status: "confirmed",
    createdAt: new Date().toISOString(),
    isTest: true,
  },
  {
    id: "seed-test-booking-2",
    customer: {
      fullName: "Turno demo",
      phone: "+54 9 11 8765 4321",
      email: "demo@turno.com",
    },
    barberId: "medico",
    serviceIds: ["tratamiento"],
    date: getSeedDate(4),
    time: "11:30",
    duration: 60,
    totalPrice: 14000,
    status: "confirmed",
    createdAt: new Date().toISOString(),
    isTest: true,
  },
];

const FIXED_IDS = new Set(FIXED_BOOKINGS.map((booking) => booking.id));

function isFixedBooking(id: string) {
  return FIXED_IDS.has(id);
}

function read(): Booking[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(list: Booking[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("bookings:changed"));
}

export const bookingStore = {
  all(): Booking[] {
    const saved = read();
    if (saved.length === 0) return FIXED_BOOKINGS.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    const savedMap = new Map(saved.map((booking) => [booking.id, booking]));
    const mergedFixed = FIXED_BOOKINGS.map((booking) => savedMap.get(booking.id) ?? booking);
    const extraBookings = saved.filter((booking) => !FIXED_IDS.has(booking.id));
    return [...mergedFixed, ...extraBookings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },
  add(b: Omit<Booking, "id" | "createdAt" | "status">): Booking {
    const booking: Booking = {
      ...b,
      id: crypto.randomUUID(),
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };
    write([...read(), booking]);
    return booking;
  },
  update(id: string, patch: Partial<Booking>) {
    const saved = read();
    const updated = saved.map((b) => (b.id === id ? { ...b, ...patch } : b));
    if (!updated.some((b) => b.id === id) && isFixedBooking(id)) {
      const fixed = FIXED_BOOKINGS.find((b) => b.id === id);
      if (fixed) {
        updated.push({ ...fixed, ...patch });
      }
    }
    write(updated);
  },
  remove(id: string) {
    if (isFixedBooking(id)) return;
    write(read().filter((b) => b.id !== id));
  },
  forDate(date: string): Booking[] {
    return this.all().filter((b) => b.date === date && b.status !== "cancelled");
  },
  occupiedSlots(date: string, barberId: string): Set<string> {
    const set = new Set<string>();
    this.all()
      .filter((b) => b.date === date && b.barberId === barberId && b.status !== "cancelled")
      .forEach((b) => {
        const [h, m] = b.time.split(":").map(Number);
        const start = h * 60 + m;
        const slots = Math.ceil(b.duration / 30);
        for (let i = 0; i < slots; i++) {
          const t = start + i * 30;
          set.add(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
        }
      });
    return set;
  },
};

export function getBarber(id: string) {
  return findProfessional(id);
}
export function getService(id: string) {
  return SERVICES.find((s) => s.id === id);
}
export function sumDuration(barberId: string, ids: string[]): number {
  return ids.reduce((a, id) => a + (getProfessionalService(barberId, id)?.duration ?? 0), 0);
}
export function sumPrice(barberId: string, ids: string[]): number {
  return ids.reduce((a, id) => a + (getProfessionalService(barberId, id)?.price ?? 0), 0);
}
