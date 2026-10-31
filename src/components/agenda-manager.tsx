import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

import { AuthRequired } from "@/components/auth-required";
import { LoadingScreen } from "@/components/loading-screen";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bookingStore, getBarber, type Booking } from "@/lib/booking-store";
import { useAppAuth } from "@/lib/auth";
import { refreshCloudData } from "@/lib/cloud-sync";
import { getAvailableSlotsForDate, getProfessionalService, getScheduleForDate, professionalStore } from "@/lib/professional-store";

export function AgendaManager() {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [editMode, setEditMode] = useState<"attendance" | "turno" | "payment" | null>(null);
  const [editedDate, setEditedDate] = useState("");
  const [editedTime, setEditedTime] = useState("");
  const [editedProfessionalId, setEditedProfessionalId] = useState("");
  const [editedServiceId, setEditedServiceId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [processingBookingId, setProcessingBookingId] = useState<string | null>(null);
  const [processingBookingStatus, setProcessingBookingStatus] = useState<Booking["status"] | null>(null);
  const [deletingBookingId, setDeletingBookingId] = useState<string | null>(null);

  useEffect(() => {
    const reload = () => setBookings(bookingStore.all());
    reload();
    window.addEventListener("bookings:changed", reload);
    return () => window.removeEventListener("bookings:changed", reload);
  }, []);

  useEffect(() => {
    const refresh = () => { void refreshCloudData().catch(() => undefined); };
    refresh();
    const intervalId = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    if (!selectedBooking) return;
    setEditedDate(selectedBooking.date);
    setEditedTime(selectedBooking.time);
    setEditedProfessionalId(selectedBooking.barberId);
    setEditedServiceId(selectedBooking.serviceIds[0] ?? "");
  }, [selectedBooking]);

  const professionals = professionalStore.all();
  const editedProfessional = professionals.find((professional) => professional.id === editedProfessionalId) ?? professionals[0];
  const editedService = editedProfessional?.services.find((service) => service.id === editedServiceId);
  const availableSlots = useMemo(() => {
    if (!editedProfessional || !editedDate || !editedService) return [];
    const date = parseISO(editedDate);
    if (Number.isNaN(date.getTime())) return [];
    const dateSlots = getAvailableSlotsForDate(editedProfessional, date);
    const schedule = getScheduleForDate(editedProfessional, date);
    const capacity = schedule?.capacity ?? 1;

    return dateSlots.filter((slot) => {
      const [hours, minutes] = slot.split(":").map(Number);
      const start = hours * 60 + minutes;
      const end = start + editedService.duration;

      for (let minute = start; minute < end; minute += 15) {
        const segment = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        if (!dateSlots.includes(segment)) return false;

        const overlapping = bookings.filter((booking) => {
          if (booking.id === selectedBooking?.id || booking.date !== editedDate
            || booking.barberId !== editedProfessional.id || booking.status === "cancelled") return false;
          const [bookingHours, bookingMinutes] = booking.time.split(":").map(Number);
          const bookingStart = bookingHours * 60 + bookingMinutes;
          return minute < bookingStart + booking.duration && bookingStart < minute + 15;
        }).length;
        if (overlapping >= capacity) return false;
      }
      return true;
    });
  }, [bookings, editedDate, editedProfessional, editedService, selectedBooking]);

  if (isLoading) return <LoadingScreen message="Preparando tu agenda" />;
  if (!isAuthenticated || role !== "admin") return <><SiteHeader /><AuthRequired role="admin" title="Agenda" /></>;

  function openDialog(booking: Booking, mode: "attendance" | "turno" | "payment") {
    setSelectedBooking(booking);
    setEditMode(mode);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setSelectedBooking(null);
    setEditMode(null);
  }

  async function saveBookingEdit() {
    if (!selectedBooking || editMode !== "turno" || savingEdit) return;
    const professional = professionalStore.get(editedProfessionalId);
    const service = professional?.services.find((item) => item.id === editedServiceId);
    if (!professional || !service) {
      toast.error("Elegí un profesional y servicio válidos.");
      return;
    }
    if (!editedDate || !availableSlots.includes(editedTime)) {
      toast.error("Elegí una fecha y un horario disponibles para la duración del servicio.");
      return;
    }
    setSavingEdit(true);
    try {
      await bookingStore.update(selectedBooking.id, {
        barberId: professional.id,
        serviceIds: [service.id],
        duration: service.duration,
        totalPrice: service.price,
        date: editedDate,
        time: editedTime,
      });
      toast.success("Turno modificado.");
      closeDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function updateBooking(id: string, patch: Partial<Booking>, success: string) {
    if (processingBookingId) return;
    setProcessingBookingId(id);
    setProcessingBookingStatus(patch.status ?? null);
    try {
      await bookingStore.update(id, patch);
      toast.success(success);
      closeDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el turno.");
    } finally {
      setProcessingBookingId(null);
      setProcessingBookingStatus(null);
    }
  }

  async function removeBooking(id: string) {
    if (deletingBookingId) return;
    setDeletingBookingId(id);
    try {
      await bookingStore.remove(id);
      toast("Turno eliminado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el turno.");
    } finally {
      setDeletingBookingId(null);
    }
  }

  const visibleBookings = bookings
    .filter((booking) => booking.status !== "cancelled")
    .sort((a, b) => {
      if (!!a.isTest === !!b.isTest) return (a.date + a.time).localeCompare(b.date + b.time);
      return a.isTest ? 1 : -1;
    });

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <section className="w-full rounded-3xl border border-gold/30 bg-card p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-gold">Control</p>
              <h1 className="mt-1 font-display text-2xl font-semibold">Agenda</h1>
            </div>
            <Link
              to="/reserva"
              className="inline-flex h-10 items-center rounded-md bg-gold px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-gold-soft"
            >
              Nuevo turno
            </Link>
          </div>
          {!visibleBookings.length ? (
            <p className="text-sm text-muted-foreground">No hay turnos agendados todavía.</p>
          ) : (
            <div className="space-y-2">
              {visibleBookings.map((booking) => {
              const professional = getBarber(booking.barberId);
              const services = booking.serviceIds.map((id) => getProfessionalService(booking.barberId, id)?.name).filter(Boolean).join(", ");
              const date = parseISO(`${booking.date}T${booking.time}`);
              const paymentMethodLabel = booking.customer.paymentMethod === "efectivo"
                ? "Efectivo"
                : booking.customer.paymentMethod === "transferencia"
                  ? "Transferencia bancaria"
                  : booking.customer.paymentMethod === "tarjeta o mercado pago"
                    ? "Tarjeta o Mercado Pago"
                    : "No especificado";
              return (
                <div key={booking.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-gold/30 bg-card p-4">
                  <div className="flex w-20 shrink-0 flex-col items-center rounded-lg bg-gold/10 px-2 py-2 text-gold">
                    <span className="text-[10px] uppercase tracking-widest">{format(date, "EEE", { locale: es })}</span>
                    <span className="font-display text-2xl font-semibold">{format(date, "d")}</span>
                    <span className="text-[10px]">{booking.time}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium">{booking.customer.fullName}</span>
                      {booking.customer.phone && <span className="text-xs text-muted-foreground">{booking.customer.phone}</span>}
                      {booking.customer.email && <span className="truncate text-xs text-muted-foreground">{booking.customer.email}</span>}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">{services} · {booking.duration} min</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="border-gold/30 text-gold">
                        {professional?.name}{professional?.specialty ? ` · ${professional.specialty}` : ""}
                      </Badge>
                      <Badge variant="outline" className="border-gold/30 text-gold">Pago · {paymentMethodLabel}</Badge>
                      {booking.isTest && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Turno de prueba</Badge>}
                      {booking.status === "pending-payment" && <Badge variant="outline" className="border-amber-300 text-amber-300">Pago pendiente</Badge>}
                      {booking.paymentReportedAt && booking.paymentStatus !== "approved" && <Badge variant="outline" className="border-amber-300 text-amber-300">Cliente avisó que pagó</Badge>}
                      {booking.paymentStatus === "approved" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Pagado · {booking.customer.paymentMethod === "tarjeta o mercado pago" ? "Mercado Pago" : booking.customer.paymentMethod === "transferencia" ? "Transferencia" : "Efectivo"}</Badge>}
                      {booking.status === "completed" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Asistió</Badge>}
                      {booking.status === "no-show" && <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300">No asistió</Badge>}
                    </div>
                  </div>
                  <div className="font-display text-lg font-semibold text-gold">${booking.totalPrice.toLocaleString("es-AR")}</div>
                  <div className="flex flex-wrap gap-2">
                    {(booking.status === "pending-payment" || (booking.paymentReportedAt && booking.paymentStatus !== "approved")) && <Button size="sm" disabled={processingBookingId !== null} onClick={() => openDialog(booking, "payment")} className="bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60">{booking.paymentReportedAt ? "Revisar pago" : "Indicar pago"}</Button>}
                    {booking.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => openDialog(booking, "attendance")}>Indicar asistencia</Button>}
                    <Button size="sm" variant="outline" onClick={() => openDialog(booking, "turno")}>Modificar turno</Button>
                    <Button size="sm" variant="destructive" disabled={booking.isTest || deletingBookingId === booking.id} className={deletingBookingId === booking.id ? "opacity-60" : undefined} onClick={() => void removeBooking(booking.id)}>{deletingBookingId === booking.id ? "Borrando..." : "Borrar turno"}</Button>
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </section>

        <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeDialog()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editMode === "attendance" ? "Asistencia" : editMode === "turno" ? "Modificar turno" : editMode === "payment" ? "Indicar pago" : ""}</DialogTitle>
              <DialogDescription>
                {editMode === "attendance" ? "Seleccioná si el cliente asistió al turno." : editMode === "turno" ? "Modificá profesional, servicio y horario." : editMode === "payment" ? "¿El cliente envió el pago del turno?" : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {editMode === "attendance" && <div className="grid gap-3 sm:grid-cols-2"><Button disabled={processingBookingId !== null} className="bg-emerald-500 text-white disabled:opacity-60" onClick={() => selectedBooking && void updateBooking(selectedBooking.id, { status: "completed" }, "Asistencia registrada")}>{processingBookingId === selectedBooking?.id && processingBookingStatus === "completed" ? "Procesando..." : "Sí asistió"}</Button><Button disabled={processingBookingId !== null} className="border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-60" onClick={() => selectedBooking && void updateBooking(selectedBooking.id, { status: "no-show" }, "Turno indicado como no asistió")}>{processingBookingId === selectedBooking?.id && processingBookingStatus === "no-show" ? "Procesando..." : "No asistió"}</Button></div>}
              {editMode === "payment" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    disabled={processingBookingId !== null}
                    className="bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60"
                    onClick={() => selectedBooking && void updateBooking(selectedBooking.id, { status: "confirmed", paymentStatus: "approved" }, "Pago confirmado y turno reservado")}
                  >
                    {processingBookingId === selectedBooking?.id && processingBookingStatus === "confirmed" ? "Procesando..." : "Sí pagó"}
                  </Button>
                  <Button
                    disabled={processingBookingId !== null}
                    className="border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-60"
                    onClick={() => selectedBooking && void updateBooking(selectedBooking.id, { status: "cancelled" }, "Pago no recibido; turno cancelado y horario liberado")}
                  >
                    {processingBookingId === selectedBooking?.id && processingBookingStatus === "cancelled" ? "Procesando..." : "No pagó"}
                  </Button>
                </div>
              )}
              {editMode === "turno" && (
                <div className="grid gap-4">
                  <label className="block text-sm text-muted-foreground">Profesional<select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedProfessionalId} onChange={(event) => { setEditedProfessionalId(event.target.value); setEditedServiceId(professionals.find((item) => item.id === event.target.value)?.services[0]?.id ?? ""); }}>
                    {professionals.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.specialty}</option>)}
                  </select></label>
                  <label className="block text-sm text-muted-foreground">Servicio<select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedServiceId} onChange={(event) => setEditedServiceId(event.target.value)}>
                    {(editedProfessional?.services ?? []).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </select></label>
                  <label className="block text-sm text-muted-foreground">Fecha<input type="date" className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedDate} onChange={(event) => { setEditedDate(event.target.value); setEditedTime(""); }} /></label>
                  <label className="block text-sm text-muted-foreground">Hora<select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedTime} onChange={(event) => setEditedTime(event.target.value)}>
                    <option value="">Seleccionar hora</option>{availableSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                  </select></label>
                </div>
              )}
            </div>
            {editMode === "turno" && <DialogFooter><Button variant="outline" disabled={savingEdit} onClick={closeDialog}>Cancelar</Button><Button className="bg-gold text-primary-foreground hover:bg-gold-soft" disabled={savingEdit} onClick={() => void saveBookingEdit()}>{savingEdit ? "Procesando..." : "Guardar cambios"}</Button></DialogFooter>}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
