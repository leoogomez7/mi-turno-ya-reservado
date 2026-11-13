import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Clock3, Copy, Scissors, Search, UserRound } from "lucide-react";
import { toast } from "sonner";

import { AuthRequired } from "@/components/auth-required";
import { LoadingScreen } from "@/components/loading-screen";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bookingStore, canArchiveBooking, canDeleteBooking, getBarber, getBookingArchiveLabel, type Booking } from "@/lib/booking-store";
import { useAppAuth } from "@/lib/auth";
import { archiveBooking, BOOKING_HIGHLIGHT_KEY, confirmBookingRefund, permanentlyDeleteArchivedBooking, refreshCloudData, restoreArchivedBooking } from "@/lib/cloud-sync";
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
  const [archiveSearch, setArchiveSearch] = useState("");
  const [bookingSearch, setBookingSearch] = useState("");
  const [restoringBookingId, setRestoringBookingId] = useState<string | null>(null);
  const [permanentlyDeletingBookingId, setPermanentlyDeletingBookingId] = useState<string | null>(null);
  const [deletingAllArchivedBookings, setDeletingAllArchivedBookings] = useState(false);
  const [refundDialogBooking, setRefundDialogBooking] = useState<Booking | null>(null);
  const [confirmingRefundId, setConfirmingRefundId] = useState<string | null>(null);
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
      const booking = bookings.find((item) => item.id === bookingId);
      if (!bookingId || !booking) return;
      sessionStorage.removeItem(BOOKING_HIGHLIGHT_KEY);
      setHighlightedBookingId(bookingId);
      const isArchived = Boolean(getBookingArchiveLabel(booking, currentTime, "admin"));
      if (isArchived) {
        setArchiveSearch("");
        setArchiveDialogOpen(true);
      }
      window.setTimeout(() => document.getElementById(`${isArchived ? "archived-" : ""}booking-${bookingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), isArchived ? 100 : 0);
      if (highlightTimeout.current !== null) window.clearTimeout(highlightTimeout.current);
      highlightTimeout.current = window.setTimeout(() => setHighlightedBookingId(""), 4000);
    };
    activateHighlight();
    window.addEventListener("mi-turno-ya:highlight-booking", activateHighlight);
    return () => window.removeEventListener("mi-turno-ya:highlight-booking", activateHighlight);
  }, [bookings, currentTime]);

  useEffect(() => {
    const refresh = () => { void refreshCloudData().catch(() => undefined); };
    const intervalId = window.setInterval(refresh, 60_000);
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

  useEffect(() => {
    if (!selectedBooking || editMode !== "turno" || !editedDate || !editedService || !editedTime) return;
    if (!availableSlots.includes(editedTime)) setEditedTime("");
  }, [availableSlots, editMode, editedDate, editedTime, editedService, selectedBooking]);

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
    if (!canArchiveBooking(booking)) {
      toast.error("Solo se puede borrar un turno pagado, asistido, cancelado o con la devolución realizada.");
      return;
    }
    setDeletingBookingId(booking.id);
    try {
      const result = await archiveBooking(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      toast.success("Turno archivado. Podés consultarlo en Turnos borrados/antiguos.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo archivar el turno.");
    } finally {
      setDeletingBookingId(null);
    }
  }

  async function restoreTurn(booking: Booking) {
    if (restoringBookingId) return;
    setRestoringBookingId(booking.id);
    try {
      const result = await restoreArchivedBooking(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      toast.success("Turno restaurado en la agenda.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo restaurar el turno.");
    } finally {
      setRestoringBookingId(null);
    }
  }

  async function permanentlyDeleteTurn(booking: Booking) {
    if (permanentlyDeletingBookingId || deletingAllArchivedBookings) return;
    if (!canDeleteBooking(booking)) {
      toast.error("Solo se puede borrar un turno pagado, asistido, cancelado o con la devolución realizada.");
      return;
    }
    setPermanentlyDeletingBookingId(booking.id);
    try {
      await permanentlyDeleteArchivedBooking(booking.id);
      setBookings((current) => current.filter((item) => item.id !== booking.id));
      toast.success("Turno eliminado definitivamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo borrar definitivamente el turno.");
    } finally {
      setPermanentlyDeletingBookingId(null);
    }
  }

  async function permanentlyDeleteAllArchivedTurns() {
    if (permanentlyDeletingBookingId || deletingAllArchivedBookings || !archivedBookings.length) return;
    const deletableBookings = archivedBookings.filter(canDeleteBooking);
    if (!deletableBookings.length) {
      toast.error("No hay turnos pagados, asistidos, cancelados o con la devolución realizada para borrar.");
      return;
    }
    setDeletingAllArchivedBookings(true);
    const deletedIds: string[] = [];
    let failedCount = archivedBookings.length - deletableBookings.length;
    try {
      for (const booking of deletableBookings) {
        try {
          await permanentlyDeleteArchivedBooking(booking.id);
          deletedIds.push(booking.id);
        } catch {
          failedCount += 1;
        }
      }
      if (deletedIds.length) setBookings((current) => current.filter((booking) => !deletedIds.includes(booking.id)));
      if (failedCount) {
        toast.error(`Se eliminaron ${deletedIds.length} turnos; ${failedCount} no cumplen los requisitos para borrarse.`);
      } else {
        toast.success(`Se eliminaron ${deletedIds.length} turnos definitivamente.`);
      }
    } finally {
      setDeletingAllArchivedBookings(false);
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

  async function confirmRefund(booking: Booking) {
    if (confirmingRefundId || booking.paymentCancellationStatus !== "requested") return;
    setConfirmingRefundId(booking.id);
    try {
      const result = await confirmBookingRefund(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      setRefundDialogBooking(null);
      toast.success("Devolución confirmada. El cliente recibirá una notificación.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo confirmar la devolución.");
    } finally {
      setConfirmingRefundId(null);
    }
  }

  async function copyRefundDestination(booking: Booking) {
    const destination = booking.refundDestination ?? booking.refundCbu;
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      toast.success(`${booking.refundDestinationType === "alias" ? "Alias" : "CBU"} copiado.`);
    } catch {
      toast.error("No se pudo copiar el CBU o alias.");
    }
  }

  const archivedBookings = bookings
    .filter((booking) => !booking.adminPermanentlyDeletedAt && getBookingArchiveLabel(booking, currentTime, "admin"))
    .sort((a, b) => (b.adminArchivedAt ?? `${b.date}T${b.time}`).localeCompare(a.adminArchivedAt ?? `${a.date}T${a.time}`));
  const normalizedArchiveSearch = archiveSearch.trim().toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const filteredArchivedBookings = archivedBookings.filter((booking) => {
    if (!normalizedArchiveSearch) return true;
    const professional = getBarber(booking.barberId);
    const services = booking.serviceIds.map((id) => getProfessionalService(booking.barberId, id)?.name ?? "").join(" ");
    const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
    const searchable = [
      booking.customer.fullName,
      booking.customer.email,
      booking.customer.phone,
      professional?.name,
      professional?.specialty,
      services,
      booking.date,
      booking.time,
      format(appointmentDate, "EEEE d 'de' MMMM yyyy", { locale: es }),
      booking.customer.paymentMethod,
      booking.status,
      getBookingArchiveLabel(booking, currentTime, "admin"),
    ].filter(Boolean).join(" ").toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return normalizedArchiveSearch.split(/\s+/).every((term) => searchable.includes(term));
  });
  const visibleBookings = bookings
    .filter((booking) => !booking.adminPermanentlyDeletedAt && !getBookingArchiveLabel(booking, currentTime, "admin"))
    .sort((a, b) => {
      if (!!a.isTest === !!b.isTest) return (a.date + a.time).localeCompare(b.date + b.time);
      return a.isTest ? 1 : -1;
    });
  const normalizedBookingSearch = bookingSearch.trim().toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const filteredVisibleBookings = visibleBookings.filter((booking) => {
    if (!normalizedBookingSearch) return true;
    const professional = getBarber(booking.barberId);
    const services = booking.serviceIds.map((id) => getProfessionalService(booking.barberId, id)?.name ?? "").join(" ");
    const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
    const searchable = [
      booking.customer.fullName,
      booking.customer.email,
      booking.customer.phone,
      professional?.name,
      professional?.specialty,
      services,
      booking.date,
      booking.time,
      format(appointmentDate, "EEEE d 'de' MMMM yyyy", { locale: es }),
      booking.customer.paymentMethod,
      booking.status,
      booking.id,
    ].filter(Boolean).join(" ").toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return normalizedBookingSearch.split(/\s+/).every((term) => searchable.includes(term));
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
              <Button type="button" variant="outline" onClick={() => setArchiveDialogOpen(true)}>Turnos borrados/antiguos</Button>
              <Link to="/reserva" className="inline-flex h-10 items-center rounded-md bg-gold px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-gold-soft">Nuevo turno</Link>
            </div>
          </div>
          <label className="relative mb-4 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={bookingSearch} onChange={(event) => setBookingSearch(event.target.value)} placeholder="Buscar turno..." className="pl-9" aria-label="Buscar turnos" />
          </label>
          {!filteredVisibleBookings.length ? (
            <p className="text-sm text-muted-foreground">{visibleBookings.length ? "No encontramos turnos con esa búsqueda." : "No hay turnos agendados todavía."}</p>
          ) : (
            <div className="space-y-2">
              {filteredVisibleBookings.map((booking) => {
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
                <div key={booking.id} id={`booking-${booking.id}`} className={`flex flex-col items-center gap-3 rounded-xl border p-4 text-center transition-colors duration-300 xl:grid xl:grid-cols-[4rem_minmax(12rem,1fr)_auto_minmax(14rem,0.8fr)_minmax(22rem,1.3fr)] xl:items-center xl:gap-4 xl:text-left ${highlightedBookingId === booking.id ? "border-gold bg-gold/20 ring-2 ring-gold/70" : "border-gold/30 bg-card"}`}>
                  <div className="flex w-full items-center justify-center gap-2 xl:contents">
                    <div className="flex w-16 shrink-0 flex-col items-center rounded-lg bg-gold/10 px-1.5 py-2 text-gold">
                      <span className="text-[10px] uppercase tracking-widest">{format(date, "EEE", { locale: es })}</span>
                      <span className="font-display text-2xl font-semibold">{format(date, "d")}</span>
                      <span className="text-[10px]">{booking.time}</span>
                    </div>
                    <div className="min-w-0 flex-1 text-center xl:flex-none xl:text-left">
                      <div className="font-medium">{professional?.name ?? "Profesional"}{professional?.specialty ? ` · ${professional.specialty}` : ""}</div>
                      <div className="text-sm text-muted-foreground">{services || "Servicio"} · {booking.duration} min</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <span>{booking.customer.fullName}</span>
                        {(booking.customer.phone || booking.customer.email) && <span className="block truncate">{[booking.customer.phone, booking.customer.email].filter(Boolean).join(" · ")}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 font-display text-base font-semibold text-gold xl:col-start-3 xl:justify-self-start xl:rounded-lg xl:border xl:border-gold/20 xl:bg-gold/5 xl:px-3 xl:py-2 xl:text-center xl:text-lg">${booking.totalPrice.toLocaleString("es-AR")}</div>
                  </div>
                  <div className="flex w-full flex-col items-center gap-1 text-xs text-muted-foreground xl:col-start-4 xl:items-start xl:justify-self-start">
                      <Badge variant="outline" className="border-gold/30 text-gold">Pago · {paymentMethodLabel}</Badge>
                      {booking.isTest && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Turno de prueba</Badge>}
                      {booking.status === "confirmed" && <Badge variant="outline" className="border-gold/30 text-gold">Reservado</Badge>}
                      {(booking.status === "pending-payment" || booking.paymentStatus === "pending") && <Badge variant="outline" className="border-amber-300 text-amber-300">Pago pendiente</Badge>}
                      {booking.paymentReportedAt && booking.paymentStatus !== "approved" && <Badge variant="outline" className="border-amber-300 text-amber-300">Cliente avisó que pagó</Badge>}
                      {booking.paymentStatus === "approved" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Pagado · {booking.customer.paymentMethod === "tarjeta o mercado pago" ? "Tarjeta o Mercado Pago" : booking.customer.paymentMethod === "transferencia" ? "Transferencia Bancaria" : "Efectivo"}</Badge>}
                      {booking.paymentCancellationStatus === "requested" && <Badge variant="outline" className="border-amber-300 text-amber-300">Devolución solicitada</Badge>}
                      {booking.paymentCancellationStatus === "refunded" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Devolución confirmada</Badge>}
                      {booking.paymentCancellationStatus === "cancelled" && <Badge variant="outline" className="border-red-300 text-red-300">Pago cancelado</Badge>}
                      {booking.status === "completed" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Asistió</Badge>}
                      {booking.status === "no-show" && <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300">No asistió</Badge>}
                      {booking.cancelledBy === "client" && <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300">Cancelado por el cliente</Badge>}
                      {booking.cancelledBy === "professional" && <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300">Cancelado por el profesional</Badge>}
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 xl:col-start-5 xl:grid-cols-3">
                    {booking.status !== "cancelled" && <>
                      {!booking.paymentCancellationStatus && booking.paymentStatus !== "approved" && (booking.status === "pending-payment" || booking.paymentStatus === "pending" || (booking.paymentReportedAt && booking.paymentStatus !== "approved")) && <Button size="sm" disabled={processingBookingId !== null} onClick={() => openDialog(booking, "payment")} className="min-w-0 whitespace-normal px-2 text-center leading-tight bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60">{booking.paymentReportedAt ? "Revisar pago" : "Indicar pago"}</Button>}
                      {booking.status === "confirmed" && booking.paymentStatus === "approved" && <Button size="sm" variant="outline" className="min-w-0 whitespace-normal px-2 text-center leading-tight" onClick={() => openDialog(booking, "attendance")}>Indicar asistencia</Button>}
                      {isActiveBooking && !booking.paymentCancellationStatus && booking.paymentStatus !== "approved" && !booking.paymentReportedAt && <Button size="sm" variant="outline" className="min-w-0 whitespace-normal px-2 text-center leading-tight" onClick={() => openDialog(booking, "turno")}>Modificar turno</Button>}
                      {isActiveBooking && !booking.paymentCancellationStatus && booking.paymentStatus !== "approved" && !booking.paymentReportedAt && <Button size="sm" variant="destructive" className={`min-w-0 whitespace-normal px-2 text-center leading-tight ${cancellingBookingId === booking.id ? "opacity-60" : ""}`} disabled={cancellingBookingId !== null} onClick={() => void cancelBooking(booking)}>{cancellingBookingId === booking.id ? "Cancelando turno..." : "Cancelar turno"}</Button>}
                    </>}
                    {booking.paymentCancellationStatus === "requested" && <Button size="sm" className="min-w-0 whitespace-normal px-2 text-center leading-tight bg-gold text-primary-foreground hover:bg-gold-soft" disabled={confirmingRefundId !== null} onClick={() => setRefundDialogBooking(booking)}>Indicar devolución</Button>}
                    {canArchiveBooking(booking) && (booking.status === "cancelled" || booking.status === "completed" || booking.status === "no-show") && <Button size="sm" variant="destructive" className="min-w-0 whitespace-normal px-2 text-center leading-tight" disabled={deletingBookingId === booking.id} onClick={() => void archiveTurn(booking)}>{deletingBookingId === booking.id ? "Borrando turno..." : "Borrar turno"}</Button>}
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </section>

        <Dialog open={refundDialogBooking !== null} onOpenChange={(open) => { if (!open && confirmingRefundId === null) setRefundDialogBooking(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{refundDialogBooking?.paymentCancellationStatus === "requested" ? "Confirmar devolución" : "Datos de la devolución"}</DialogTitle>
              {refundDialogBooking?.customer.paymentMethod !== "tarjeta o mercado pago" && <DialogDescription>{refundDialogBooking?.paymentCancellationStatus === "requested" ? "Revisá el importe y los datos de devolución. Al confirmar, avisaremos al cliente que el dinero ya fue devuelto." : "El turno ya está cancelado y su horario disponible."}</DialogDescription>}
            </DialogHeader>
            {refundDialogBooking && <div className="space-y-2 rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm">
              <p>Cliente: <span className="font-medium text-foreground">{refundDialogBooking.customer.fullName}</span></p>
              <p>Importe a devolver: <span className="font-semibold text-gold">${(refundDialogBooking.refundAmount ?? refundDialogBooking.totalPrice).toLocaleString("es-AR")}</span></p>
              {(refundDialogBooking.refundDestination || refundDialogBooking.refundCbu) && <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 break-all">{refundDialogBooking.refundDestinationType === "alias" ? "Alias" : "CBU"}: <span className="font-mono font-semibold text-foreground">{refundDialogBooking.refundDestination ?? refundDialogBooking.refundCbu}</span></p>
                <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label={`Copiar ${refundDialogBooking.refundDestinationType === "alias" ? "alias" : "CBU"}`} title={`Copiar ${refundDialogBooking.refundDestinationType === "alias" ? "alias" : "CBU"}`} onClick={() => void copyRefundDestination(refundDialogBooking)}><Copy className="h-4 w-4" /></Button>
              </div>}
            </div>}
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" disabled={confirmingRefundId !== null} onClick={() => setRefundDialogBooking(null)}>{refundDialogBooking?.paymentCancellationStatus === "requested" ? "Volver" : "Cerrar"}</Button>
              {refundDialogBooking?.paymentCancellationStatus === "requested" && <Button type="button" className="bg-gold text-primary-foreground hover:bg-gold-soft" disabled={confirmingRefundId !== null} onClick={() => void confirmRefund(refundDialogBooking)}>{confirmingRefundId === refundDialogBooking.id ? "Confirmando…" : "Confirmar devolución"}</Button>}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
          <DialogContent className="gold-scrollbar max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Turnos borrados/antiguos</DialogTitle>
              <DialogDescription>Turnos archivados, con asistencia registrada o antiguos. Podés restaurarlos o borrarlos definitivamente del listado.</DialogDescription>
            </DialogHeader>
            {archivedBookings.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Borrar todos los turnos de este listado, aunque haya una búsqueda activa.</p>
              <Button type="button" size="sm" variant="destructive" disabled={deletingAllArchivedBookings || permanentlyDeletingBookingId !== null} onClick={() => void permanentlyDeleteAllArchivedTurns()}>{deletingAllArchivedBookings ? "Borrando…" : "Borrar todos"}</Button>
            </div>}
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder="Buscar en los turnos archivados…" className="pl-9" aria-label="Buscar turnos archivados" />
            </label>
            {!filteredArchivedBookings.length ? <p className="py-5 text-center text-sm text-muted-foreground">{archivedBookings.length ? "No encontramos turnos con esa búsqueda." : "Todavía no hay turnos archivados."}</p> : (
              <div className="space-y-2">
                {filteredArchivedBookings.map((booking) => {
                  const professional = getBarber(booking.barberId);
                  const services = booking.serviceIds.map((id) => getProfessionalService(booking.barberId, id)?.name).filter(Boolean).join(", ");
                  const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
                  const paymentMethod = booking.customer.paymentMethod === "transferencia" ? "Transferencia bancaria" : booking.customer.paymentMethod === "tarjeta o mercado pago" ? "Tarjeta o Mercado Pago" : booking.customer.paymentMethod === "efectivo" ? "Efectivo" : "No especificado";
                  return <article key={booking.id} id={`archived-booking-${booking.id}`} className={`rounded-xl border p-3 text-sm transition-colors duration-300 ${highlightedBookingId === booking.id ? "border-gold bg-gold/20 ring-2 ring-gold/70" : "border-border bg-card"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 font-semibold">{booking.customer.fullName} · {professional?.name ?? "Profesional"}</p>
                      <Badge variant="outline" className="shrink-0 border-gold/40 text-gold">{getBookingArchiveLabel(booking, currentTime, "admin")}</Badge>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0 space-y-1 text-muted-foreground">
                        <p>{services || "Servicio"} · {format(appointmentDate, "EEEE d 'de' MMMM, yyyy", { locale: es })} · {booking.time}</p>
                        <p>Pago: {paymentMethod} · ${booking.totalPrice.toLocaleString("es-AR")}</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" disabled={restoringBookingId !== null || deletingAllArchivedBookings} onClick={() => void restoreTurn(booking)}>{restoringBookingId === booking.id ? "Restaurando…" : "Restaurar"}</Button>
                        <Button type="button" size="sm" variant="destructive" disabled={permanentlyDeletingBookingId !== null || deletingAllArchivedBookings || !canDeleteBooking(booking)} onClick={() => void permanentlyDeleteTurn(booking)}>{permanentlyDeletingBookingId === booking.id ? "Borrando…" : "Borrar turno"}</Button>
                      </div>
                    </div>
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
                    onClick={() => selectedBooking && void updateBooking(selectedBooking.id, { status: "confirmed", paymentStatus: "approved" }, "Pago confirmado")}
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
                  <label className="block text-sm text-muted-foreground"><span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-gold" />Profesional</span><select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedProfessionalId} onChange={(event) => { setEditedProfessionalId(event.target.value); setEditedServiceId(professionals.find((item) => item.id === event.target.value)?.services[0]?.id ?? ""); setEditedDate(""); setEditedTime(""); }}>
                    {professionals.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.specialty}</option>)}
                  </select></label>
                  <label className="block text-sm text-muted-foreground"><span className="flex items-center gap-2"><Scissors className="h-4 w-4 text-gold" />Servicio</span><select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedServiceId} onChange={(event) => { setEditedServiceId(event.target.value); setEditedTime(""); }}>
                    {(editedProfessional?.services ?? []).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </select></label>
                  <label className="block text-sm text-muted-foreground"><span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-gold" />Fecha</span><input type="date" className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedDate} onChange={(event) => { setEditedDate(event.target.value); setEditedTime(""); }} /></label>
                  <label className="block text-sm text-muted-foreground"><span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-gold" />Horario</span><select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedTime} onChange={(event) => setEditedTime(event.target.value)}>
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
