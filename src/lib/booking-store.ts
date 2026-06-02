import { BARBERS, SERVICES, type Barber, type Service } from "./salon-data";

export interface Customer {
  fullName: string;
  phone: string;
  email: string;
  birthday?: string;
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
}

const KEY = "salon_bookings_v1";

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
    return read().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
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
    write(read().map((b) => (b.id === id ? { ...b, ...patch } : b)));
  },
  remove(id: string) {
    write(read().filter((b) => b.id !== id));
  },
  forDate(date: string): Booking[] {
    return read().filter((b) => b.date === date && b.status !== "cancelled");
  },
  occupiedSlots(date: string, barberId: string): Set<string> {
    const set = new Set<string>();
    read()
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

export function getBarber(id: string): Barber | undefined {
  return BARBERS.find((b) => b.id === id);
}
export function getService(id: string): Service | undefined {
  return SERVICES.find((s) => s.id === id);
}
export function sumDuration(ids: string[]): number {
  return ids.reduce((a, id) => a + (getService(id)?.duration ?? 0), 0);
}
export function sumPrice(ids: string[]): number {
  return ids.reduce((a, id) => a + (getService(id)?.price ?? 0), 0);
}
