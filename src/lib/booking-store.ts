import { getProfessional as findProfessional, getProfessionalService } from "./professional-store";
import { getCloudRecords, isCloudInitialized, persistCloudCollection } from "./cloud-sync";

export interface Customer {
  fullName: string;
  phone: string;
  email: string;
  paymentMethod?: "efectivo" | "transferencia" | "tarjeta o mercado pago";
  notes?: string;
}

export interface Booking {
  id: string;
  storeCode?: string;
  customer: Customer;
  barberId: string;
  serviceIds: string[];
  date: string;
  time: string;
  duration: number;
  totalPrice: number;
  status: "pending-payment" | "confirmed" | "cancelled" | "completed" | "no-show";
  appointmentConfirmation?: "confirmed" | "pending";
  createdAt: string;
  isTest?: boolean;
}

function read(): Booking[] {
  return isCloudInitialized() ? getCloudRecords("bookings") : [];
}

async function write(list: Booking[]) {
  await persistCloudCollection("bookings", list);
}

export const bookingStore = {
  all(): Booking[] {
    return read().slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },
  async add(input: Omit<Booking, "id" | "createdAt">): Promise<Booking> {
    const booking: Booking = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await write([...read(), booking]);
    return booking;
  },
  async update(id: string, patch: Partial<Booking>) {
    const current = read();
    const updated = current.map((booking) => booking.id === id ? { ...booking, ...patch } : booking);
    if (!updated.some((booking) => booking.id === id)) throw new Error("No encontramos ese turno.");
    await write(updated);
  },
  async remove(id: string) {
    await write(read().filter((booking) => booking.id !== id));
  },
  occupiedSlots(date: string, barberId: string): Set<string> {
    const slots = new Set<string>();
    this.all()
      .filter((booking) => booking.date === date && booking.barberId === barberId && booking.status !== "cancelled")
      .forEach((booking) => {
        const [hours, minutes] = booking.time.split(":").map(Number);
        const start = hours * 60 + minutes;
        const count = Math.ceil(booking.duration / 30);
        for (let index = 0; index < count; index += 1) {
          const minute = start + index * 30;
          slots.add(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
        }
      });
    return slots;
  },
};

export function getBarber(id: string) {
  return findProfessional(id);
}

export function sumDuration(barberId: string, ids: string[]): number {
  return ids.reduce((sum, id) => sum + (getProfessionalService(barberId, id)?.duration ?? 0), 0);
}

export function sumPrice(barberId: string, ids: string[]): number {
  return ids.reduce((sum, id) => sum + (getProfessionalService(barberId, id)?.price ?? 0), 0);
}
