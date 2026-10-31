import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SiteHeader } from "@/components/site-header";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import type { Booking } from "@/lib/booking-store";
import { getAvailableSlotsForDate, getScheduleForDate, type Professional } from "@/lib/professional-store";
import { deleteClientBooking, getClientBookings, reportClientPayment, updateClientBooking } from "@/lib/cloud-sync";
import { toast } from "sonner";
import { LoadingScreen } from "@/components/loading-screen";

export const Route = createFileRoute("/mis-turnos")({
  head: () => ({ meta: [{ title: "Mis turnos" }] }),
  component: MyBookingsPage,
});

function MyBookingsPage() {
  const { isAuthenticated, isLoading, role, user } = useAppAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [occupiedSlots, setOccupiedSlots] = useState<Pick<Booking, "id" | "storeCode" | "barberId" | "date" | "time" | "duration" | "status">[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [editedDate, setEditedDate] = useState("");
  const [editedTime, setEditedTime] = useState("");

  const editingProfessional = editingBooking
    ? professionals.find((item) => item.id === editingBooking.barberId && item.storeCode === editingBooking.storeCode)
      ?? professionals.find((item) => item.id === editingBooking.barberId)
    : undefined;
  const availableEditSlots = useMemo(() => {
    if (!editingProfessional || !editedDate) return [];
    const date = parseISO(`${editedDate}T12:00:00`);
    if (Number.isNaN(date.getTime())) return [];
    const today = format(new Date(), "yyyy-MM-dd");
    if (editedDate < today) return [];
    const slots = getAvailableSlotsForDate(editingProfessional, date);
    const capacity = getScheduleForDate(editingProfessional, date)?.capacity ?? 1;
    const neededIntervals = Math.ceil((editingBooking?.duration ?? 0) / 15);
    return slots.filter((slot) => {
      const [hours, minutes] = slot.split(":").map(Number);
      const start = hours * 60 + minutes;
      for (let interval = 0; interval < neededIntervals; interval += 1) {
        const minute = start + interval * 15;
        const nextSlot = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        if (!slots.includes(nextSlot)) return false;
        const overlapping = occupiedSlots.filter((booking) => {
          if (booking.id === editingBooking?.id || booking.storeCode !== editingBooking?.storeCode
            || booking.barberId !== editingProfessional.id || booking.date !== editedDate
            || booking.status === "cancelled") return false;
          const [bookingHours, bookingMinutes] = booking.time.split(":").map(Number);
          const bookingStart = bookingHours * 60 + bookingMinutes;
          const bookingEnd = bookingStart + booking.duration;
          return minute < bookingEnd && bookingStart < minute + 15;
        }).length;
        if (overlapping >= capacity) return false;
      }
      return true;
    });
  }, [editedDate, editingBooking, editingProfessional, occupiedSlots]);

  const reload = useCallback(async () => {
    try {
      const result = await getClientBookings();
      setBookings(result.bookings);
      setProfessionals(result.professionals);
      setOccupiedSlots(result.occupiedSlots);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar tus turnos.");
    } finally {
      setLoadingBookings(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || role !== "client") return;
    void reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [isAuthenticated, reload, role]);

  async function reportPayment(booking: Booking) {
    if (busyBookingId) return;
    setBusyBookingId(booking.id);
    try {
      const result = await reportClientPayment(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      toast.success("Aviso enviado. El profesional verificará el pago.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo avisar al profesional.");
    } finally {
      setBusyBookingId(null);
    }
  }

  async function saveBookingTime() {
    if (!editingBooking || busyBookingId) return;
    if (!editedDate || !availableEditSlots.includes(editedTime)) {
      toast.error("Elegí una fecha y un horario disponibles.");
      return;
    }
    setBusyBookingId(editingBooking.id);
    try {
      const result = await updateClientBooking(editingBooking.id, editedDate, editedTime);
      setBookings((current) => current.map((item) => item.id === editingBooking.id ? result.booking : item));
      setEditingBooking(null);
      toast.success("Turno modificado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo modificar el turno.");
    } finally {
      setBusyBookingId(null);
    }
  }

  async function deleteBooking(booking: Booking) {
    if (busyBookingId) return;
    setBusyBookingId(booking.id);
    try {
      await deleteClientBooking(booking.id);
      setBookings((current) => current.filter((item) => item.id !== booking.id));
      toast.success("Turno eliminado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el turno.");
    } finally {
      setBusyBookingId(null);
    }
  }

  if (isLoading) return <LoadingScreen message="Buscando tus turnos" />;
  if (!isAuthenticated || role !== "client") return <><SiteHeader /><AuthRequired role="client" title="Mis turnos" /></>;

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <section className="w-full rounded-3xl border border-gold/30 bg-card p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-gold">Reservar</p>
              <h1 className="mt-1 font-display text-2xl font-semibold">Mis turnos</h1>
            </div>
            <Link
              to="/reserva"
              className="inline-flex h-10 items-center rounded-md bg-gold px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-gold-soft"
            >
              Nuevo turno
            </Link>
          </div>
          {loadingBookings ? (
            <p className="text-sm text-muted-foreground">Cargando tus turnos…</p>
          ) : !bookings.length ? (
            <p className="text-sm text-muted-foreground">Todavía no hay turnos asociados a esta cuenta.</p>
          ) : (
            <div className="space-y-2">
            {bookings.map((booking) => {
              const professional = professionals.find((item) => item.id === booking.barberId && item.storeCode === booking.storeCode)
                ?? professionals.find((item) => item.id === booking.barberId);
              const serviceNames = booking.serviceIds.map((id) => professional?.services.find((service) => service.id === id)?.name).filter(Boolean).join(", ");
              const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
              const statusLabel = booking.status === "pending-payment" ? "Pago pendiente" : booking.status === "completed" ? "Asistió" : booking.status === "no-show" ? "No asistió" : booking.status === "cancelled" ? "Cancelado" : "Reservado";
              const statusClass = booking.status === "completed" ? "border-emerald-300 text-emerald-400" : booking.status === "cancelled" || booking.status === "no-show" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-gold/40 text-gold";
              const paymentMethodLabel = booking.customer.paymentMethod === "efectivo"
                ? "Efectivo"
                : booking.customer.paymentMethod === "transferencia"
                  ? "Transferencia bancaria"
                  : booking.customer.paymentMethod === "tarjeta o mercado pago"
                    ? "Tarjeta o Mercado Pago"
                    : "No especificado";
              const isActiveBooking = booking.status === "confirmed" || booking.status === "pending-payment";
              const canDelete = isActiveBooking && (
                booking.customer.paymentMethod === "efectivo"
                || (booking.customer.paymentMethod === "transferencia" && booking.paymentStatus !== "approved")
              );
              return (
                <article key={booking.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-gold/30 bg-card p-4">
                  <div className="flex w-20 shrink-0 flex-col items-center rounded-lg bg-gold/10 px-2 py-2 text-gold">
                    <span className="text-[10px] uppercase tracking-widest">{format(appointmentDate, "EEE", { locale: es })}</span>
                    <span className="font-display text-2xl font-semibold">{format(appointmentDate, "d")}</span>
                    <span className="text-[10px]">{booking.time}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{professional?.name ?? "Profesional"}</div>
                    <div className="truncate text-sm text-muted-foreground">{serviceNames || "Servicio"} · {booking.duration} min</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className={statusClass}>{statusLabel}</Badge>
                      <Badge variant="outline" className="border-gold/30 text-gold">Pago · {paymentMethodLabel}</Badge>
                      {booking.paymentReportedAt && booking.paymentStatus !== "approved" && <Badge variant="outline" className="border-amber-300 text-amber-300">Avisaste que pagaste · Podés modificar hasta que lo verifique el profesional</Badge>}
                      {booking.paymentStatus === "approved" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Pago confirmado · Solo el profesional puede modificarlo</Badge>}
                    </div>
                  </div>
                  <div className="font-display text-lg font-semibold text-gold">${booking.totalPrice.toLocaleString("es-AR")}</div>
                  {isActiveBooking && <div className="flex flex-wrap gap-2">
                    {booking.paymentStatus !== "approved" && !booking.paymentReportedAt && <Button size="sm" disabled={busyBookingId !== null} className="bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60" onClick={() => void reportPayment(booking)}>{busyBookingId === booking.id ? "Confirmando..." : "Confirmar pago"}</Button>}
                    <Button size="sm" variant="outline" disabled={busyBookingId !== null} onClick={() => {
                      if (booking.paymentStatus === "approved") {
                        toast.error("El profesional ya confirmó el pago. Solo él puede modificar este turno.");
                        return;
                      }
                      setEditingBooking(booking);
                      setEditedDate(booking.date);
                      setEditedTime(booking.time);
                    }}>Modificar turno</Button>
                    {canDelete && <Button size="sm" variant="destructive" disabled={busyBookingId !== null} className={busyBookingId === booking.id ? "opacity-60" : undefined} onClick={() => void deleteBooking(booking)}>{busyBookingId === booking.id ? "Borrando..." : "Borrar turno"}</Button>}
                  </div>}
                </article>
              );
            })}
          </div>
        )}
        </section>
      </main>
      <Dialog open={editingBooking !== null} onOpenChange={(open) => { if (!open && !busyBookingId) setEditingBooking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modificar turno</DialogTitle>
            <DialogDescription>Podés cambiar solamente el día y el horario. La disponibilidad se verifica antes de guardar.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <label className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-gold" />Día</span>
              <input type="date" min={format(new Date(), "yyyy-MM-dd")} value={editedDate} onChange={(event) => { setEditedDate(event.target.value); setEditedTime(""); }} className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" />
            </label>
            <label className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-gold" />Horario</span>
              <select value={editedTime} onChange={(event) => setEditedTime(event.target.value)} className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" disabled={!editedDate || !editingProfessional}>
                <option value="">Seleccionar horario</option>
                {availableEditSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
              </select>
              {editedDate && !availableEditSlots.length && <span className="block text-xs">No hay horarios disponibles para ese día.</span>}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busyBookingId !== null} onClick={() => setEditingBooking(null)}>Cancelar</Button>
            <Button type="button" disabled={!editingBooking || busyBookingId !== null} className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void saveBookingTime()}>{busyBookingId === editingBooking?.id ? "Guardando..." : "Guardar cambios"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
