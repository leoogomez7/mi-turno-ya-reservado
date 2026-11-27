import { getProfessional as findProfessional, getProfessionalService } from "./professional-store";
import {
  getCloudRecords,
  isCloudInitialized,
  persistCloudCollection,
  updateAdminBooking,
} from "./cloud-sync";

export interface Customer {
  fullName: string;
  phone: string;
  email: string;
  paymentMethod?: "efectivo" | "transferencia" | "tarjeta o mercado pago";
  notes?: string;
}

export interface BookingCancellationPolicy {
  noRefunds: boolean;
  allowRefunds: boolean;
  refundPercent: number;
  cancellationWindowMinutes: number;
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
  clientCancellationRefundEligible?: boolean;
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
  cancellationPolicyAtBooking?: BookingCancellationPolicy;
  basePrice?: number;
  couponCode?: string;
  couponDiscountAmount?: number;
  paymentAdjustmentAmount?: number;
  paymentAdjustmentMode?: "none" | "discount" | "surcharge";
  paymentAdjustmentPercent?: number;
  pricingPolicyAtBooking?: {
    discountCoupons: Array<{
      code: string;
      discountType: "percent" | "fixed";
      discountValue: number;
      active: boolean;
    }>;
    paymentPriceAdjustments: Record<
      "efectivo" | "transferencia" | "tarjeta o mercado pago",
      { mode: "none" | "discount" | "surcharge"; percent: number }
    >;
  };
  appointmentConfirmation?: "confirmed" | "pending";
  cancellationToken?: string;
  slotHoldId?: string;
  createdAt: string;
  isTest?: boolean;
}

export function hasPendingRefund(booking: Booking) {
  return (
    booking.paymentCancellationStatus === "requested" &&
    Number(booking.refundAmount ?? booking.totalPrice) > 0
  );
}

export function hasPaymentReportedOrApproved(booking: Booking) {
  return booking.paymentStatus === "approved" || Boolean(booking.paymentReportedAt);
}

export function requiresRefundResolution(booking: Booking) {
  if (
    booking.status !== "cancelled" ||
    booking.paymentCancellationStatus === "refunded"
  ) {
    return false;
  }
  if (booking.cancelledBy === "professional") return hasPaymentReportedOrApproved(booking);
  if (booking.paymentStatus !== "approved") return false;
  if (booking.cancelledBy === "client")
    return booking.clientCancellationRefundEligible === true;
  const policy = booking.cancellationPolicyAtBooking;
  return (
    !policy ||
    (!policy.noRefunds && policy.allowRefunds && policy.refundPercent > 0)
  );
}

export function canDeleteBooking(booking: Booking) {
  if (hasPendingRefund(booking)) return false;
  const cancelledWithoutRefundEligibility =
    booking.status === "cancelled" &&
    booking.cancelledBy === "client" &&
    booking.clientCancellationRefundEligible !== true;
  if (
    Boolean(booking.paymentReportedAt) &&
    booking.paymentStatus !== "approved" &&
    booking.paymentCancellationStatus !== "refunded" &&
    !cancelledWithoutRefundEligibility
  )
    return false;

  if (booking.status === "cancelled") {
    return !requiresRefundResolution(booking);
  }

  if (booking.paymentStatus === "pending" || booking.status === "pending-payment") return false;
  return (
    booking.status === "completed" ||
    booking.paymentStatus === "approved" ||
    booking.paymentCancellationStatus === "refunded"
  );
}

export function canArchiveBooking(booking: Booking) {
  if (hasPendingRefund(booking) || requiresRefundResolution(booking)) return false;
  if (booking.status === "cancelled" && booking.cancelledBy === "client") return true;
  return canDeleteBooking(booking);
}

export function getBookingArchiveLabel(
  booking: Booking,
  now = Date.now(),
  audience: "client" | "admin" = "client",
) {
  const archivedAt = audience === "client" ? booking.clientArchivedAt : booking.adminArchivedAt;
  const restoredAt = audience === "client" ? booking.clientRestoredAt : booking.adminRestoredAt;
  if (restoredAt) return null;
  if (archivedAt) {
    return audience === "admin" ? "Eliminado de la agenda" : "Eliminado de tu lista";
  }
  if (booking.paymentCancellationStatus === "requested") return null;
  if (booking.status !== "completed" && booking.status !== "no-show") return null;
  const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
  if (Number.isFinite(appointmentAt) && now >= appointmentAt + 24 * 60 * 60 * 1000)
    return "Antiguo · Pasaron 24 horas";
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
    return read()
      .slice()
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },
  async add(input: Omit<Booking, "id" | "createdAt">): Promise<Booking> {
    const booking: Booking = {
      ...input,
      id: crypto.randomUUID(),
      ...(input.status === "pending-payment" ||
      input.customer.paymentMethod === "tarjeta o mercado pago"
        ? { cancellationToken: crypto.randomUUID() }
        : {}),
      createdAt: new Date().toISOString(),
    };
    await write([...read(), booking], booking.storeCode);
    return read().find((item) => item.id === booking.id) ?? booking;
  },
  async update(id: string, patch: Partial<Booking>) {
    if (!read().some((booking) => booking.id === id)) throw new Error("No encontramos ese turno.");
    return updateAdminBooking(id, patch);
  },
  async remove(id: string) {
    const current = read();
    const targetStoreCode = current.find((booking) => booking.id === id)?.storeCode;
    await write(
      current.filter((booking) => booking.id !== id),
      targetStoreCode,
    );
  },
  remainingCapacity(
    date: string,
    barberId: string,
    time: string,
    duration: number,
    capacity: number,
  ): number {
    const [hours, minutes] = time.split(":").map(Number);
    const start = hours * 60 + minutes;
    const end = start + duration;
    const relevantBookings = this.all().filter(
      (booking) =>
        booking.date === date &&
        booking.barberId === barberId &&
        booking.status !== "cancelled" &&
        (() => {
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
