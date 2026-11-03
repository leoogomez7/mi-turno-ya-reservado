import { useEffect, useMemo, useRef, useState } from "react";
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
import { bookingStore, getBarber, getBookingArchiveLabel, type Booking } from "@/lib/booking-store";
import { useAppAuth } from "@/lib/auth";
import { archiveBooking, BOOKING_HIGHLIGHT_KEY, refreshCloudData } from "@/lib/cloud-sync";
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
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [highlightedBookingId, setHighlightedBookingId] = useState("");
  const highlightTimeout = useRef<number | null>(null);

  useEffect(() => {
    const reload = () => setBookings(bookingStore.all());
    reload();
    window.addEventListener("bookings:changed", reload);
    return () => window.removeEventListener("bookings:changed", reload);
  }, []);

  useEffect(() => {
    const activateHighlight = () => {
      const bookingId = sessionStorage.getItem(BOOKING_HIGHLIGHT_KEY);
      if (!bookingId || !bookings.some((booking) => booking.id === bookingId)) return;
      sessionStorage.removeItem(BOOKING_HIGHLIGHT_KEY);
      setHighlightedBookingId(bookingId);
      window.setTimeout(() => document.getElementById(`booking-${bookingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      if (highlightTimeout.current !== null) window.clearTimeout(highlightTimeout.current);
      highlightTimeout.current = window.setTimeout(() => setHighlightedBookingId(""), 4000);
    };
    activateHighlight();
    window.addEventListener("mi-turno-ya:highlight-booking", activateHighlight);
    return () => window.removeEventListener("mi-turno-ya:highlight-booking", activateHighlight);
  }, [bookings]);

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
    const intervalId = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(intervalId);
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

  async function archiveTurn(booking: Booking) {
    if (deletingBookingId) return;
    setDeletingBookingId(booking.id);
    try {
      const result = await archiveBooking(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      toast.success("Turno archivado. Podés consultarlo en Turnos eliminados/antiguos.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo archivar el turno.");
    } finally {
      setDeletingBookingId(null);
    }
  }

  async function cancelBooking(booking: Booking) {
    if (cancellingBookingId || booking.status === "cancelled") return;
    setCancellingBookingId(booking.id);
    try {
      await bookingStore.update(booking.id, { status: "cancelled", cancelledBy: "professional" });
      toast.success("Turno cancelado. El cliente recibirá una notificación.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar el turno.");
    } finally {
      setCancellingBookingId(null);
    }
  }

  const archivedBookings = bookings
    .filter((booking) => getBookingArchiveLabel(booking, currentTime, "admin"))
    .sort((a, b) => (b.adminArchivedAt ?? `${b.date}T${b.time}`).localeCompare(a.adminArchivedAt ?? `${a.date}T${a.time}`));
  const visibleBookings = bookings
    .filter((booking) => !getBookingArchiveLabel(booking, currentTime, "admin"))
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
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setArchiveDialogOpen(true)}>Turnos eliminados/antiguos</Button>
              <Link to="/reserva" className="inline-flex h-10 items-center rounded-md bg-gold px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-gold-soft">Nuevo turno</Link>
            </div>
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
              const isActiveBooking = booking.status === "confirmed" || booking.status === "pending-payment";
              return (
                <div key={booking.id} id={`booking-${booking.id}`} className={`flex flex-wrap items-center gap-4 rounded-xl border p-4 transition-colors duration-300 ${highlightedBookingId === booking.id ? "border-gold bg-gold/20 ring-2 ring-gold/70" : "border-gold/30 bg-card"}`}>
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
                      {booking.cancelledBy === "client" && <Badge variant="outline" className="border-red-300 text-red-300">Cancelado por el cliente · Revisar si eliminar</Badge>}
                      {booking.cancelledBy === "professional" && <Badge variant="outline" className="border-red-300 text-red-300">Cancelado por el profesional</Badge>}
                      <Badge variant="outline" className="border-gold/30 text-gold">Pago · {paymentMethodLabel}</Badge>
                      {booking.isTest && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Turno de prueba</Badge>}
                      {(booking.status === "pending-payment" || booking.paymentStatus === "pending") && <Badge variant="outline" className="border-amber-300 text-amber-300">Pago pendiente</Badge>}
                      {booking.paymentReportedAt && booking.paymentStatus !== "approved" && <Badge variant="outline" className="border-amber-300 text-amber-300">Cliente avisó que pagó</Badge>}
                      {booking.paymentStatus === "approved" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Pagado · {booking.customer.paymentMethod === "tarjeta o mercado pago" ? "Tarjeta o Mercado Pago" : booking.customer.paymentMethod === "transferencia" ? "Transferencia Bancaria" : "Efectivo"}</Badge>}
                      {booking.paymentCancellationStatus === "requested" && <Badge variant="outline" className="border-amber-300 text-amber-300">Devolución solicitada</Badge>}
                      {booking.paymentCancellationStatus === "refunded" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Pago devuelto por Mercado Pago</Badge>}
                      {booking.paymentCancellationStatus === "cancelled" && <Badge variant="outline" className="border-red-300 text-red-300">Pago cancelado en Mercado Pago</Badge>}
                      {booking.status === "completed" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Asistió</Badge>}
                      {booking.status === "no-show" && <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300">No asistió</Badge>}
                    </div>
                    {booking.refundCbu && <p className="mt-2 text-sm text-amber-200">CBU para devolver ${(booking.refundAmount ?? booking.totalPrice).toLocaleString("es-AR")}: <span className="font-mono font-semibold text-foreground">{booking.refundCbu}</span></p>}
                  </div>
                  <div className="font-display text-lg font-semibold text-gold">${booking.totalPrice.toLocaleString("es-AR")}</div>
                  <div className="flex flex-wrap gap-2">
                    {!booking.paymentCancellationStatus && booking.paymentStatus !== "approved" && (booking.status === "pending-payment" || booking.paymentStatus === "pending" || (booking.paymentReportedAt && booking.paymentStatus !== "approved")) && <Button size="sm" disabled={processingBookingId !== null} onClick={() => openDialog(booking, "payment")} className="bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60">{booking.paymentReportedAt ? "Revisar pago" : "Indicar pago"}</Button>}
                    {booking.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => openDialog(booking, "attendance")}>Indicar asistencia</Button>}
                    {isActiveBooking && !booking.paymentCancellationStatus && booking.paymentStatus !== "approved" && !booking.paymentReportedAt && <Button size="sm" variant="outline" onClick={() => openDialog(booking, "turno")}>Modificar turno</Button>}
                    {isActiveBooking && !booking.paymentCancellationStatus && booking.paymentStatus !== "approved" && !booking.paymentReportedAt && <Button size="sm" variant="destructive" disabled={cancellingBookingId !== null} className={cancellingBookingId === booking.id ? "opacity-60" : undefined} onClick={() => void cancelBooking(booking)}>{cancellingBookingId === booking.id ? "Cancelando turno..." : "Cancelar turno"}</Button>}
                    {booking.paymentCancellationStatus === "requested" && booking.customer.paymentMethod !== "tarjeta o mercado pago" && <Button size="sm" className="bg-emerald-500 text-white hover:bg-emerald-600" disabled={processingBookingId !== null} onClick={() => void updateBooking(booking.id, { paymentCancellationStatus: "refunded" }, "Devolución confirmada; el cliente recibirá una notificación")}>Marcar devolución realizada</Button>}
                    <Button size="sm" variant="destructive" disabled={deletingBookingId === booking.id} className={deletingBookingId === booking.id ? "opacity-60" : undefined} onClick={() => void archiveTurn(booking)}>{deletingBookingId === booking.id ? "Borrando turno..." : "Borrar turno"}</Button>
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </section>

        <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Turnos eliminados/antiguos</DialogTitle>
              <DialogDescription>Turnos archivados con «Borrar turno», con asistencia registrada o que terminaron hace más de 24 horas.</DialogDescription>
            </DialogHeader>
            {!archivedBookings.length ? <p className="py-5 text-center text-sm text-muted-foreground">Todavía no hay turnos archivados.</p> : (
              <div className="space-y-2">
                {archivedBookings.map((booking) => {
                  const professional = getBarber(booking.barberId);
                  const services = booking.serviceIds.map((id) => getProfessionalService(booking.barberId, id)?.name).filter(Boolean).join(", ");
                  const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
                  const paymentMethod = booking.customer.paymentMethod === "transferencia" ? "Transferencia bancaria" : booking.customer.paymentMethod === "tarjeta o mercado pago" ? "Tarjeta o Mercado Pago" : booking.customer.paymentMethod === "efectivo" ? "Efectivo" : "No especificado";
                  return <article key={booking.id} className="rounded-xl border border-border bg-card p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold">{booking.customer.fullName} · {professional?.name ?? "Profesional"}</p>
                      <Badge variant="outline" className="border-gold/40 text-gold">{getBookingArchiveLabel(booking, currentTime, "admin")}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{services || "Servicio"} · {format(appointmentDate, "EEEE d 'de' MMMM, yyyy", { locale: es })} · {booking.time}</p>
                    <p className="mt-1 text-muted-foreground">Pago: {paymentMethod} · ${booking.totalPrice.toLocaleString("es-AR")}</p>
                  </article>;
                })}
              </div>
            )}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setArchiveDialogOpen(false)}>Cerrar</Button></DialogFooter>
          </DialogContent>
        </Dialog>

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
