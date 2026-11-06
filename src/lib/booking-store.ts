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
  cancelledBy?: "client" | "professional";
  clientArchivedAt?: string;
  adminArchivedAt?: string;
  clientRestoredAt?: string;
  adminRestoredAt?: string;
  clientPermanentlyDeletedAt?: string;
  adminPermanentlyDeletedAt?: string;
  paymentStatus?: "pending" | "approved";
  paymentReportedAt?: string;
  paymentCancellationStatus?: "requested" | "cancelled" | "refunded";
  paymentCancellationRequestedAt?: string;
  refundCbu?: string;
  refundDestination?: string;
  refundDestinationType?: "cbu" | "alias";
  refundAmount?: number;
  refundRequestedAt?: string;
  refundConfirmedAt?: string;
  appointmentConfirmation?: "confirmed" | "pending";
  cancellationToken?: string;
  createdAt: string;
  isTest?: boolean;
}

export function getBookingArchiveLabel(booking: Booking, now = Date.now(), audience: "client" | "admin" = "client") {
  const archivedAt = audience === "client" ? booking.clientArchivedAt : booking.adminArchivedAt;
  const restoredAt = audience === "client" ? booking.clientRestoredAt : booking.adminRestoredAt;
  if (restoredAt) return null;
  if (archivedAt) {
    return audience === "admin" ? "Eliminado de la agenda" : "Eliminado de tu lista";
  }
  if (booking.paymentCancellationStatus === "requested") return null;
  if (booking.status === "completed") return "Asistencia confirmada · Asistió";
  if (booking.status === "no-show") return "Asistencia confirmada · No asistió";
  const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
  if (Number.isFinite(appointmentAt) && now >= appointmentAt + 24 * 60 * 60 * 1000) return "Antiguo · Pasaron 24 horas";
  return null;
}

function read(): Booking[] {
  return isCloudInitialized() ? getCloudRecords("bookings") : [];
}

async function write(list: Booking[], storeCode?: string) {
  await persistCloudCollection("bookings", list, storeCode);
}

export const bookingStore = {
  all(): Booking[] {
    return read().slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },
  async add(input: Omit<Booking, "id" | "createdAt">): Promise<Booking> {
    const booking: Booking = {
      ...input,
      id: crypto.randomUUID(),
      ...(input.status === "pending-payment" || input.customer.paymentMethod === "tarjeta o mercado pago" ? { cancellationToken: crypto.randomUUID() } : {}),
      createdAt: new Date().toISOString(),
    };
    await write([...read(), booking], booking.storeCode);
    return booking;
  },
  async update(id: string, patch: Partial<Booking>) {
    const current = read();
    const targetStoreCode = current.find((booking) => booking.id === id)?.storeCode;
    const updated = current.map((booking) => booking.id === id ? { ...booking, ...patch } : booking);
    if (!updated.some((booking) => booking.id === id)) throw new Error("No encontramos ese turno.");
    await write(updated, targetStoreCode);
  },
  async remove(id: string) {
    const current = read();
    const targetStoreCode = current.find((booking) => booking.id === id)?.storeCode;
    await write(current.filter((booking) => booking.id !== id), targetStoreCode);
  },
  remainingCapacity(date: string, barberId: string, time: string, duration: number, capacity: number): number {
    const [hours, minutes] = time.split(":").map(Number);
    const start = hours * 60 + minutes;
    const end = start + duration;
    const relevantBookings = this.all().filter((booking) =>
      booking.date === date
      && booking.barberId === barberId
      && booking.status !== "cancelled"
      && (() => {
        const [bookingHours, bookingMinutes] = booking.time.split(":").map(Number);
        const bookingStart = bookingHours * 60 + bookingMinutes;
        return start < bookingStart + booking.duration && bookingStart < end;
      })(),
    );
    let maxOverlapping = 0;
    for (let minute = start; minute < end; minute += 15) {
      const overlapping = relevantBookings.filter((booking) => {
        const [bookingHours, bookingMinutes] = booking.time.split(":").map(Number);
        const bookingStart = bookingHours * 60 + bookingMinutes;
        return minute < bookingStart + booking.duration && bookingStart < minute + 15;
      }).length;
      maxOverlapping = Math.max(maxOverlapping, overlapping);
    }
    return Math.max(0, capacity - maxOverlapping);
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
