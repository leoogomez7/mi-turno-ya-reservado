import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Clock3, Copy, LoaderCircle, Scissors, Search, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SiteHeader } from "@/components/site-header";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import { canArchiveBooking, canDeleteBooking, getBookingArchiveLabel, type Booking } from "@/lib/booking-store";
import { getAvailableSlotsForDate, getScheduleForDate, type Professional } from "@/lib/professional-store";
import { archiveBooking, BOOKING_HIGHLIGHT_KEY, cancelClientBooking, cancelClientPayment, createClientBookingPaymentPreference, getClientBookings, permanentlyDeleteArchivedBooking, reportClientPayment, restoreArchivedBooking, updateClientBooking, updateClientPaymentMethod, type Store } from "@/lib/cloud-sync";
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
  const [stores, setStores] = useState<Pick<Store, "code" | "name" | "settings">[]>([]);
  const [occupiedSlots, setOccupiedSlots] = useState<Pick<Booking, "id" | "storeCode" | "barberId" | "date" | "time" | "duration" | "status">[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  const [payingBookingId, setPayingBookingId] = useState<string | null>(null);
  const [deletingBookingId, setDeletingBookingId] = useState<string | null>(null);
  const [cancelingBookingId, setCancelingBookingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [preparingEditBookingId, setPreparingEditBookingId] = useState<string | null>(null);
  const [editedProfessionalId, setEditedProfessionalId] = useState("");
  const [editedServiceId, setEditedServiceId] = useState("");
  const [editedDate, setEditedDate] = useState("");
  const [editedTime, setEditedTime] = useState("");
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [bookingSearch, setBookingSearch] = useState("");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [restoringBookingId, setRestoringBookingId] = useState<string | null>(null);
  const [permanentlyDeletingBookingId, setPermanentlyDeletingBookingId] = useState<string | null>(null);
  const [deletingAllArchivedBookings, setDeletingAllArchivedBookings] = useState(false);
  const [showTransferDetails, setShowTransferDetails] = useState(false);
  const [changingPaymentBooking, setChangingPaymentBooking] = useState<Booking | null>(null);
  const [newPaymentMethod, setNewPaymentMethod] = useState<NonNullable<Booking["customer"]["paymentMethod"]>>("efectivo");
  const [refundDestination, setRefundDestination] = useState("");
  const [refundDestinationType, setRefundDestinationType] = useState<"cbu" | "alias">("cbu");
  const suppressPaymentClick = useRef(false);
  const [highlightedBookingId, setHighlightedBookingId] = useState("");
  const highlightTimeout = useRef<number | null>(null);

  const editableProfessionals = editingBooking
    ? professionals.filter((item) => item.storeCode === editingBooking.storeCode)
    : [];
  const editingProfessional = editableProfessionals.find((item) => item.id === editedProfessionalId);
  const editingService = editingProfessional?.services.find((service) => service.id === editedServiceId);
  const availableEditSlots = useMemo(() => {
    if (!editingProfessional || !editingService || !editedDate) return [];
    const date = parseISO(`${editedDate}T12:00:00`);
    if (Number.isNaN(date.getTime())) return [];
    const today = format(new Date(), "yyyy-MM-dd");
    if (editedDate < today) return [];
    const slots = getAvailableSlotsForDate(editingProfessional, date);
    const capacity = getScheduleForDate(editingProfessional, date)?.capacity ?? 1;
    const neededIntervals = Math.ceil(editingService.duration / 15);
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
  }, [editedDate, editingBooking, editingProfessional, editingService, occupiedSlots]);

  useEffect(() => {
    if (!editingBooking || preparingEditBookingId === editingBooking.id || !editedDate || !editingService || !editedTime) return;
    if (!availableEditSlots.includes(editedTime)) setEditedTime("");
  }, [availableEditSlots, editedDate, editedTime, editingBooking, editingService, preparingEditBookingId]);

  const reload = useCallback(async () => {
    try {
      const result = await getClientBookings();
      setBookings(result.bookings);
      setProfessionals(result.professionals);
      setOccupiedSlots(result.occupiedSlots);
      setStores(result.stores);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar tus turnos.");
    } finally {
      setLoadingBookings(false);
    }
  }, []);

  async function openEditDialog(booking: Booking) {
    setEditingBooking(booking);
    setEditedProfessionalId(booking.barberId);
    setEditedServiceId(booking.serviceIds[0] ?? "");
    setEditedDate(booking.date);
    setEditedTime(booking.time);
    setPreparingEditBookingId(booking.id);
    try {
      await reload();
    } finally {
      setPreparingEditBookingId(null);
    }
  }

  useEffect(() => {
    if (!isAuthenticated || role !== "client") return;
    void reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [isAuthenticated, reload, role]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const activateHighlight = () => {
      const bookingId = sessionStorage.getItem(BOOKING_HIGHLIGHT_KEY);
      const booking = bookings.find((item) => item.id === bookingId);
      if (!bookingId || !booking) return;
      sessionStorage.removeItem(BOOKING_HIGHLIGHT_KEY);
      setHighlightedBookingId(bookingId);
      const isArchived = Boolean(getBookingArchiveLabel(booking, currentTime, "client"));
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

  async function reportPayment(booking: Booking) {
    if (busyBookingId) return;
    setBusyBookingId(booking.id);
    try {
      const result = await reportClientPayment(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      setPaymentBooking(null);
      toast.success("Aviso enviado. El profesional verificará el pago.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo avisar al profesional.");
    } finally {
      setBusyBookingId(null);
    }
  }

  async function copyPaymentDetail(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Dato copiado.");
    } catch {
      toast.error("No se pudo copiar el dato.");
    }
  }

  async function payBooking(booking: Booking) {
    if (suppressPaymentClick.current || busyBookingId || booking.paymentStatus === "approved") return;
    if (booking.customer.paymentMethod === "efectivo") return;
    if (booking.customer.paymentMethod === "transferencia") {
      setShowTransferDetails(true);
      return;
    }
    const paymentTab = window.open("about:blank", "_blank");
    if (!paymentTab) {
      toast.error("Permití las ventanas emergentes para abrir el pago en otra pestaña.");
      return;
    }
    paymentTab.opener = null;
    setBusyBookingId(booking.id);
    setPayingBookingId(booking.id);
    try {
      const { initPoint } = await createClientBookingPaymentPreference(booking.id);
      paymentTab.location.href = initPoint;
    } catch (error) {
      paymentTab.close();
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar el pago.");
    } finally {
      setBusyBookingId(null);
      setPayingBookingId(null);
    }
  }

  async function cancelPayment(booking: Booking) {
    if (busyBookingId || booking.paymentCancellationStatus) return;
    const policy = cancellationPolicyFor(booking);
    if (policy?.noRefunds || policy?.allowRefunds === false || (policy?.refundPercent ?? 100) <= 0) {
      toast.error("La política de esta sucursal no permite devolver pagos.");
      return;
    }
    const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
    const windowMinutes = policy?.cancellationWindowMinutes ?? 30;
    if (booking.paymentStatus !== "approved") {
      toast.error("Solo podés solicitar la devolución cuando el profesional haya confirmado el pago.");
      return;
    }
    if ((booking.customer.paymentMethod === "efectivo" || booking.customer.paymentMethod === "transferencia")
      && !isValidRefundDestination(refundDestinationType, refundDestination)) {
      toast.error(refundDestinationType === "cbu" ? "Ingresá un CBU válido de 22 dígitos." : "Ingresá un alias válido de 6 a 30 caracteres.");
      return;
    }
    if (!Number.isFinite(appointmentAt) || appointmentAt - Date.now() < windowMinutes * 60 * 1000) {
      toast.error(`Solo podés solicitar la cancelación con al menos ${windowMinutes} minutos de anticipación.`);
      return;
    }
    setBusyBookingId(booking.id);
    try {
      const needsDestination = booking.customer.paymentMethod === "efectivo" || booking.customer.paymentMethod === "transferencia";
      const result = await cancelClientPayment(booking.id, needsDestination ? refundDestinationType : undefined, needsDestination ? refundDestination.trim() : undefined);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      setPaymentBooking(null);
      setRefundDestination("");
      toast.success("Solicitud de devolución enviada. El turno se canceló y el horario quedó disponible; el profesional confirmará la devolución.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar el pago.");
    } finally {
      setBusyBookingId(null);
    }
  }

  function isValidRefundDestination(type: "cbu" | "alias", value: string) {
    return type === "cbu" ? /^\d{22}$/.test(value.replace(/\s/g, "")) : /^[\p{L}\d._-]{6,30}$/u.test(value.trim());
  }

  async function savePaymentMethod() {
    if (!changingPaymentBooking || busyBookingId || changingPaymentBooking.paymentReportedAt || changingPaymentBooking.paymentStatus === "approved") return;
    suppressPaymentClick.current = true;
    setBusyBookingId(changingPaymentBooking.id);
    try {
      const result = await updateClientPaymentMethod(changingPaymentBooking.id, newPaymentMethod);
      setBookings((current) => current.map((item) => item.id === changingPaymentBooking.id ? result.booking : item));
      setPaymentBooking(result.booking);
      setChangingPaymentBooking(null);
      setShowTransferDetails(false);
      toast.success("Método de pago actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el método de pago.");
    } finally {
      setBusyBookingId(null);
      window.setTimeout(() => { suppressPaymentClick.current = false; }, 600);
    }
  }

  async function saveBookingTime() {
    if (!editingBooking || busyBookingId) return;
    if (!editingProfessional || !editingService) {
      toast.error("Elegí un profesional y un servicio disponibles.");
      return;
    }
    if (!editedDate || !availableEditSlots.includes(editedTime)) {
      toast.error("Elegí una fecha y un horario disponibles para el servicio.");
      return;
    }
    setBusyBookingId(editingBooking.id);
    try {
      const result = await updateClientBooking(editingBooking.id, {
        barberId: editingProfessional.id,
        serviceId: editingService.id,
        date: editedDate,
        time: editedTime,
      });
      setBookings((current) => current.map((item) => item.id === editingBooking.id ? result.booking : item));
      setEditingBooking(null);
      toast.success("Turno modificado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo modificar el turno.");
      await reload();
    } finally {
      setBusyBookingId(null);
    }
  }

  async function cancelBooking(booking: Booking) {
    if (busyBookingId) return;
    setBusyBookingId(booking.id);
    setCancelingBookingId(booking.id);
    try {
      const result = await cancelClientBooking(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      toast.success("Turno cancelado. El profesional podrá verlo en su agenda.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar el turno.");
    } finally {
      setBusyBookingId(null);
      setCancelingBookingId(null);
    }
  }

  async function archiveTurn(booking: Booking) {
    if (busyBookingId || getBookingArchiveLabel(booking, currentTime, "client")) return;
    if (!canArchiveBooking(booking)) {
      toast.error("Solo se puede borrar un turno pagado, asistido, cancelado o con la devolución realizada.");
      return;
    }
    setBusyBookingId(booking.id);
    setDeletingBookingId(booking.id);
    try {
      const result = await archiveBooking(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      toast.success("Turno archivado. Podés consultarlo en Turnos borrados/antiguos.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo archivar el turno.");
    } finally {
      setBusyBookingId(null);
      setDeletingBookingId(null);
    }
  }

  async function restoreTurn(booking: Booking) {
    if (restoringBookingId) return;
    setRestoringBookingId(booking.id);
    try {
      const result = await restoreArchivedBooking(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      toast.success("Turno restaurado en tu lista principal.");
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

  function cancellationPolicyFor(booking: Booking) {
    return stores.find((store) => store.code === booking.storeCode)?.settings;
  }

  const archivedBookings = bookings
    .filter((booking) => !booking.clientPermanentlyDeletedAt && getBookingArchiveLabel(booking, currentTime, "client"))
    .sort((a, b) => (b.clientArchivedAt ?? `${b.date}T${b.time}`).localeCompare(a.clientArchivedAt ?? `${a.date}T${a.time}`));
  const visibleBookings = bookings.filter((booking) => !booking.clientPermanentlyDeletedAt && !getBookingArchiveLabel(booking, currentTime, "client"));
  const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase("es-AR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const filterBookings = (list: Booking[], query: string) => {
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return list;
    return list.filter((booking) => {
      const professional = professionals.find((item) => item.id === booking.barberId && item.storeCode === booking.storeCode)
        ?? professionals.find((item) => item.id === booking.barberId);
      const serviceNames = booking.serviceIds.map((id) => professional?.services.find((service) => service.id === id)?.name ?? "").join(" ");
      const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
      const searchable = [
        booking.customer.fullName,
        booking.customer.email,
        booking.customer.phone,
        professional?.name,
        professional?.specialty,
        serviceNames,
        booking.date,
        booking.time,
        format(appointmentDate, "EEEE d 'de' MMMM yyyy", { locale: es }),
        booking.customer.paymentMethod,
        booking.status,
        booking.id,
      ].filter(Boolean).join(" ");
      const normalized = normalizeSearch(searchable);
      return terms.every((term) => normalized.includes(term));
    });
  };
  const filteredVisibleBookings = filterBookings(visibleBookings, bookingSearch);
  const filteredArchivedBookings = filterBookings(archivedBookings, archiveSearch);

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
            <div className="flex shrink-0 flex-nowrap gap-2">
              <Button type="button" variant="outline" className="h-9 min-w-0 whitespace-nowrap px-2 text-[11px] sm:px-4 sm:text-sm" onClick={() => setArchiveDialogOpen(true)}>Turnos borrados/antiguos</Button>
              <Link to="/reserva" className="inline-flex h-9 shrink-0 items-center rounded-md bg-gold px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-gold-soft sm:h-10 sm:px-4 sm:text-sm">Nuevo turno</Link>
            </div>
          </div>
          <label className="relative mb-4 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={bookingSearch} onChange={(event) => setBookingSearch(event.target.value)} placeholder="Buscar turno..." className="pl-9" aria-label="Buscar mis turnos" />
          </label>
          {loadingBookings ? (
            <p className="text-sm text-muted-foreground">Cargando tus turnos…</p>
          ) : !filteredVisibleBookings.length ? (
            <p className="text-sm text-muted-foreground">{visibleBookings.length ? "No encontramos turnos con esa búsqueda." : "Todavía no hay turnos asociados a esta cuenta."}</p>
          ) : (
            <div className="space-y-2">
            {filteredVisibleBookings.map((booking) => {
              const professional = professionals.find((item) => item.id === booking.barberId && item.storeCode === booking.storeCode)
                ?? professionals.find((item) => item.id === booking.barberId);
              const serviceNames = booking.serviceIds.map((id) => professional?.services.find((service) => service.id === id)?.name).filter(Boolean).join(", ");
              const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
              const statusLabel = booking.status === "completed" ? "Asistió" : booking.status === "no-show" ? "No asistió" : booking.status === "cancelled" ? booking.cancelledBy === "professional" ? "Cancelado por el profesional" : "Cancelado por el cliente" : "Reservado";
              const statusClass = booking.status === "completed" ? "border-emerald-300 text-emerald-400" : booking.status === "cancelled" || booking.status === "no-show" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-gold/40 text-gold";
              const paymentMethodLabel = booking.customer.paymentMethod === "efectivo"
                ? "Efectivo"
                : booking.customer.paymentMethod === "transferencia"
                  ? "Transferencia bancaria"
                  : booking.customer.paymentMethod === "tarjeta o mercado pago"
                    ? "Tarjeta o Mercado Pago"
                    : "No especificado";
              const policy = cancellationPolicyFor(booking);
              const isActiveBooking = booking.status === "confirmed" || booking.status === "pending-payment";
              const hasPaymentReport = Boolean(booking.paymentReportedAt) || booking.paymentStatus === "approved";
              const cancellationTooLate = !Number.isFinite(Date.parse(`${booking.date}T${booking.time}:00-03:00`))
                || Date.parse(`${booking.date}T${booking.time}:00-03:00`) - currentTime < (policy?.cancellationWindowMinutes ?? 30) * 60 * 1000;
              const canCancel = isActiveBooking && !hasPaymentReport && !cancellationTooLate && [
                "efectivo",
                "transferencia",
                "tarjeta o mercado pago",
              ].includes(booking.customer.paymentMethod ?? "");
              const canRequestPaymentCancellation = isActiveBooking && booking.paymentStatus === "approved" && !policy?.noRefunds && policy?.allowRefunds !== false
                && (policy?.refundPercent ?? 100) > 0 && !cancellationTooLate
                && ["efectivo", "transferencia", "tarjeta o mercado pago"].includes(booking.customer.paymentMethod ?? "");
              const canArchive = !getBookingArchiveLabel(booking, currentTime, "client");
              return (
                <article key={booking.id} id={`booking-${booking.id}`} className={`flex flex-col items-center gap-3 rounded-xl border p-4 text-center transition-colors duration-300 xl:grid xl:grid-cols-[4rem_minmax(12rem,1fr)_auto_minmax(14rem,0.8fr)_minmax(22rem,1.3fr)] xl:items-center xl:gap-4 xl:text-left ${highlightedBookingId === booking.id ? "border-gold bg-gold/20 ring-2 ring-gold/70" : "border-gold/30 bg-card"}`}>
                  <div className="flex w-full items-center justify-center gap-2 xl:contents">
                    <div className="flex w-16 shrink-0 flex-col items-center rounded-lg bg-gold/10 px-1.5 py-2 text-gold">
                      <span className="text-[10px] uppercase tracking-widest">{format(appointmentDate, "EEE", { locale: es })}</span>
                      <span className="font-display text-2xl font-semibold">{format(appointmentDate, "d")}</span>
                      <span className="text-[10px]">{booking.time}</span>
                    </div>
                    <div className="min-w-0 flex-1 text-center xl:text-left">
                      <div className="font-medium">{professional?.name ?? "Profesional"}</div>
                      <div className="text-sm text-muted-foreground">{serviceNames || "Servicio"} · {booking.duration} min</div>
                    </div>
                    <div className="shrink-0 font-display text-base font-semibold text-gold xl:col-start-3 xl:rounded-lg xl:border xl:border-gold/20 xl:bg-gold/5 xl:px-3 xl:py-2 xl:text-center xl:text-lg">${booking.totalPrice.toLocaleString("es-AR")}</div>
                  </div>
                  <div className="flex w-full flex-col items-center gap-1 text-xs text-muted-foreground xl:col-start-4 xl:items-start xl:justify-self-start">
                      {booking.status !== "cancelled" && booking.status !== "completed" && booking.status !== "no-show" && <Badge variant="outline" className={statusClass}>{statusLabel}</Badge>}
                      <Badge variant="outline" className="border-gold/30 text-gold">Pago · {paymentMethodLabel}</Badge>
                      {(booking.status === "pending-payment" || booking.paymentStatus === "pending") && <Badge variant="outline" className="border-amber-300 text-amber-300">Pago pendiente</Badge>}
                      {booking.paymentReportedAt && booking.paymentStatus !== "approved" && <Badge variant="outline" className="border-amber-300 text-amber-300">Informaste el pago · El profesional lo revisará</Badge>}
                      {booking.paymentStatus === "approved" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Pago confirmado</Badge>}
                      {booking.paymentCancellationStatus === "requested" && <Badge variant="outline" className="border-amber-300 text-amber-300">Devolución solicitada</Badge>}
                      {booking.paymentCancellationStatus === "refunded" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Pago devuelto</Badge>}
                      {booking.paymentCancellationStatus === "cancelled" && <Badge variant="outline" className="border-red-300 text-red-300">Pago cancelado</Badge>}
                      {(booking.status === "completed" || booking.status === "no-show") && <Badge variant="outline" className={statusClass}>{statusLabel}</Badge>}
                      {booking.status === "cancelled" && <Badge variant="outline" className={statusClass}>{statusLabel}</Badge>}
                  </div>
                  {(isActiveBooking || (canArchive && canArchiveBooking(booking))) && <div className="grid w-full grid-cols-2 gap-2 xl:col-start-5 xl:grid-cols-3">
                    {isActiveBooking && !hasPaymentReport && booking.paymentStatus !== "approved" && <Button size="sm" disabled={busyBookingId !== null} className="min-w-0 whitespace-normal px-2 text-center leading-tight bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60" onClick={() => { setPaymentBooking(booking); setShowTransferDetails(false); }}>Indicar pago</Button>}
                    {canRequestPaymentCancellation && !booking.paymentCancellationStatus && <Button size="sm" className="min-w-0 whitespace-normal px-2 text-center leading-tight bg-gold text-primary-foreground hover:bg-gold-soft" disabled={busyBookingId !== null} onClick={() => { setRefundDestination(""); setRefundDestinationType("cbu"); setPaymentBooking(booking); setShowTransferDetails(false); }}>Solicitar devolución</Button>}
                    {isActiveBooking && booking.paymentStatus !== "approved" && !hasPaymentReport && !booking.paymentCancellationStatus && <Button size="sm" variant="outline" className="min-w-0 whitespace-normal px-2 text-center leading-tight" disabled={busyBookingId !== null || preparingEditBookingId !== null} onClick={() => void openEditDialog(booking)}>{preparingEditBookingId === booking.id ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin text-gold" />Preparando...</> : "Modificar turno"}</Button>}
                    {canCancel && <Button size="sm" variant="destructive" className={`min-w-0 whitespace-normal px-2 text-center leading-tight ${cancelingBookingId === booking.id ? "opacity-60" : ""}`} disabled={busyBookingId !== null} onClick={() => void cancelBooking(booking)}>{cancelingBookingId === booking.id ? "Cancelando turno..." : "Cancelar turno"}</Button>}
                    {canArchive && canArchiveBooking(booking) && <Button size="sm" variant="destructive" className={`min-w-0 whitespace-normal px-2 text-center leading-tight ${deletingBookingId === booking.id ? "opacity-60" : ""}`} disabled={busyBookingId !== null} onClick={() => void archiveTurn(booking)}>{deletingBookingId === booking.id ? "Borrando turno..." : "Borrar turno"}</Button>}
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
            <DialogDescription>{preparingEditBookingId === editingBooking?.id ? "Preparando horarios disponibles…" : "Elegí profesional, servicio, fecha y horario. Revisaremos la disponibilidad antes de guardar."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <label className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-gold" />Profesional</span>
              <select value={editedProfessionalId} onChange={(event) => {
                const nextProfessionalId = event.target.value;
                setEditedProfessionalId(nextProfessionalId);
                setEditedServiceId(editableProfessionals.find((item) => item.id === nextProfessionalId)?.services[0]?.id ?? "");
                setEditedDate("");
                setEditedTime("");
              }} className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
                <option value="">Seleccionar profesional</option>
                {editableProfessionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.name}{professional.specialty ? ` · ${professional.specialty}` : ""}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><Scissors className="h-4 w-4 text-gold" />Servicio</span>
              <select value={editedServiceId} onChange={(event) => { setEditedServiceId(event.target.value); setEditedDate(""); setEditedTime(""); }} className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" disabled={!editingProfessional}>
                <option value="">Seleccionar servicio</option>
                {(editingProfessional?.services ?? []).map((service) => <option key={service.id} value={service.id}>{service.name} · {service.duration} min · ${service.price.toLocaleString("es-AR")}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-gold" />Fecha</span>
              <input type="date" min={format(new Date(), "yyyy-MM-dd")} value={editedDate} disabled={!editingProfessional || !editingService} onChange={(event) => { setEditedDate(event.target.value); setEditedTime(""); }} className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
            <label className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-gold" />Horario</span>
              <select value={editedTime} onChange={(event) => setEditedTime(event.target.value)} className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" disabled={!editedDate || !editingProfessional || preparingEditBookingId === editingBooking?.id}>
                <option value="">Seleccionar horario</option>
                {availableEditSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
              </select>
              {preparingEditBookingId === editingBooking?.id && <span className="block text-xs text-gold">Actualizando disponibilidad…</span>}
              {preparingEditBookingId !== editingBooking?.id && editedDate && editingService && !availableEditSlots.length && <span className="block text-xs">No hay horarios disponibles para ese servicio en esa fecha.</span>}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busyBookingId !== null} onClick={() => setEditingBooking(null)}>Cancelar</Button>
            <Button type="button" disabled={!editingBooking || busyBookingId !== null || preparingEditBookingId !== null} className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void saveBookingTime()}>{busyBookingId === editingBooking?.id ? "Guardando..." : preparingEditBookingId === editingBooking?.id ? "Preparando..." : "Guardar cambios"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent className="gold-scrollbar max-h-[85vh] overflow-y-auto sm:max-w-2xl" onOpenAutoFocus={(event) => event.preventDefault()}>
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
                const professional = professionals.find((item) => item.id === booking.barberId && item.storeCode === booking.storeCode)
                  ?? professionals.find((item) => item.id === booking.barberId);
                const serviceNames = booking.serviceIds.map((id) => professional?.services.find((service) => service.id === id)?.name).filter(Boolean).join(", ");
                const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
                const paymentMethod = booking.customer.paymentMethod === "transferencia" ? "Transferencia bancaria" : booking.customer.paymentMethod === "tarjeta o mercado pago" ? "Tarjeta o Mercado Pago" : booking.customer.paymentMethod === "efectivo" ? "Efectivo" : "No especificado";
                return <article key={booking.id} id={`archived-booking-${booking.id}`} className={`rounded-xl border p-3 text-sm transition-colors duration-300 ${highlightedBookingId === booking.id ? "border-gold bg-gold/20 ring-2 ring-gold/70" : "border-border bg-card"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold">{professional?.name ?? "Profesional"} · {serviceNames || "Servicio"}</p>
                    <Badge variant="outline" className="border-gold/40 text-gold">{getBookingArchiveLabel(booking, currentTime, "client")}</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">{format(appointmentDate, "EEEE d 'de' MMMM, yyyy", { locale: es })} · {booking.time}</p>
                  <p className="mt-1 text-muted-foreground">Pago: {paymentMethod} · ${booking.totalPrice.toLocaleString("es-AR")}</p>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={restoringBookingId !== null || deletingAllArchivedBookings} onClick={() => void restoreTurn(booking)}>{restoringBookingId === booking.id ? "Restaurando…" : "Restaurar"}</Button>
                    <Button type="button" size="sm" variant="destructive" disabled={permanentlyDeletingBookingId !== null || deletingAllArchivedBookings || !canDeleteBooking(booking)} onClick={() => void permanentlyDeleteTurn(booking)}>{permanentlyDeletingBookingId === booking.id ? "Borrando…" : "Borrar turno"}</Button>
                  </div>
                </article>;
              })}
            </div>
          )}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setArchiveDialogOpen(false)}>Cerrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={paymentBooking !== null} onOpenChange={(open) => { if (!open && !busyBookingId) { setPaymentBooking(null); setShowTransferDetails(false); } }}>
        <DialogContent className={showTransferDetails ? "sm:max-w-lg" : "sm:max-w-2xl"}>
          <DialogHeader>
            <DialogTitle>{showTransferDetails ? "Datos para la transferencia" : paymentBooking?.paymentCancellationStatus ? "Solicitud enviada" : paymentBooking?.paymentStatus === "approved" ? "Solicitar devolución" : "Confirmar pago"}</DialogTitle>
            <DialogDescription>
              {showTransferDetails
                ? `Realizá la transferencia bancaria.`
                : paymentBooking?.paymentCancellationStatus
                  ? "La solicitud quedó registrada. El turno está cancelado y el horario disponible; el profesional confirmará la devolución."
                  : paymentBooking?.paymentStatus === "approved"
                    ? "Revisá la información antes de solicitar la devolución. El turno se cancelará y el horario quedará disponible."
                    : "Revisá el método de pago elegido y seleccioná cómo querés continuar."}
            </DialogDescription>
          </DialogHeader>
          {paymentBooking && showTransferDetails ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
              {(() => {
                const settings = stores.find((store) => store.code === paymentBooking.storeCode)?.settings;
                const cbu = settings?.transferCbu?.trim() ?? "";
                const alias = settings?.transferAlias?.trim() ?? "";
                const copyableLabel = cbu ? "CBU" : alias ? "Alias" : null;
                const details = [
                  { label: "Titular", value: settings?.transferHolder ?? "" },
                  { label: "Banco", value: settings?.transferBank ?? "" },
                  { label: "CBU", value: cbu },
                  { label: "Alias", value: alias },
                ];
                return <>
                  {details.map(({ label, value }) => <div key={label} className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="break-all font-medium">{value || "No informado"}</p></div>
                    {label === copyableLabel && value && <Button type="button" size="icon" variant="ghost" aria-label={`Copiar ${label}`} onClick={() => void copyPaymentDetail(value)}><Copy className="h-4 w-4" /></Button>}
                  </div>)}
                  <p className="border-t border-border pt-3 font-semibold text-gold">Total a pagar: ${paymentBooking.totalPrice.toLocaleString("es-AR")}</p>
                </>;
              })()}
            </div>
          ) : paymentBooking && paymentBooking.paymentCancellationStatus ? (
            <div className="space-y-2 rounded-xl border border-amber-300/30 bg-amber-300/5 p-4 text-sm">
              <p className="font-medium text-amber-200">La solicitud de devolución ya fue enviada. El turno está cancelado y el horario quedó disponible.</p>
              {paymentBooking.refundDestination && <p>{paymentBooking.refundDestinationType === "alias" ? "Alias informado" : "CBU informado"}: <span className="font-mono text-foreground">{paymentBooking.refundDestination}</span></p>}
            </div>
          ) : paymentBooking?.paymentStatus === "approved" ? (
            <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm">
              {(() => {
                const policy = cancellationPolicyFor(paymentBooking);
                const percent = policy?.refundPercent ?? 100;
                const amount = Math.round(paymentBooking.totalPrice * percent / 100);
                return <p className="font-medium text-gold">Política de devolución: {percent}% · Importe estimado: ${amount.toLocaleString("es-AR")}.</p>;
              })()}
              {(paymentBooking.customer.paymentMethod === "transferencia" || paymentBooking.customer.paymentMethod === "efectivo") ? <>
                <p>Ingresá el dato donde el profesional debe devolver el dinero. Indicá si es CBU o alias. Al enviar la solicitud, el turno se cancela y el horario queda disponible.</p>
                <label className="grid gap-2 text-muted-foreground">
                  <span>Seleccionar CBU/Alias</span>
                  <select value={refundDestinationType} onChange={(event) => { setRefundDestinationType(event.target.value as "cbu" | "alias"); setRefundDestination(""); }} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
                    <option value="cbu">CBU (22 dígitos)</option>
                    <option value="alias">Alias</option>
                  </select>
                  <span>{refundDestinationType === "cbu" ? "CBU para recibir la devolución" : "Alias para recibir la devolución"}</span>
                  <input value={refundDestination} onChange={(event) => setRefundDestination(refundDestinationType === "cbu" ? event.target.value.replace(/\D/g, "").slice(0, 22) : event.target.value.slice(0, 30))} inputMode={refundDestinationType === "cbu" ? "numeric" : "text"} autoComplete="off" placeholder={refundDestinationType === "cbu" ? "22 dígitos" : "ejemplo.alias"} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-foreground" aria-label={`${refundDestinationType === "cbu" ? "CBU" : "Alias"} para la devolución`} />
                </label>
              </> : <p>El profesional gestionará la devolución de Mercado Pago o tarjeta. Al enviar la solicitud, el turno se cancela y el horario queda disponible; recibirás un aviso cuando confirme que hizo la devolución.</p>}
              {(() => {
                const minutesRemaining = (Date.parse(`${paymentBooking.date}T${paymentBooking.time}:00-03:00`) - currentTime) / 60_000;
                const windowMinutes = cancellationPolicyFor(paymentBooking)?.cancellationWindowMinutes ?? 30;
                return minutesRemaining < windowMinutes
                  ? <p role="alert" className="text-red-300">La solicitud solo está disponible con al menos {windowMinutes} minutos de anticipación.</p>
                  : null;
              })()}
            </div>
          ) : paymentBooking ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
              <p>Método de pago: <span className="font-medium text-gold">{paymentBooking.customer.paymentMethod === "transferencia" ? "Transferencia bancaria" : paymentBooking.customer.paymentMethod === "tarjeta o mercado pago" ? "Tarjeta o Mercado Pago" : paymentBooking.customer.paymentMethod === "efectivo" ? "Efectivo" : "No especificado"}</span></p>
              <p>Total a pagar: <span className="font-semibold text-gold">${paymentBooking.totalPrice.toLocaleString("es-AR")}</span></p>
              {paymentBooking.customer.paymentMethod === "efectivo" && <p className="text-muted-foreground">El pago en efectivo se realiza en la sucursal; el pago en línea no está disponible para este método de pago.</p>}
            </div>
          ) : null}
          <DialogFooter className="flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-4 sm:space-x-0">
            {showTransferDetails ? (
              <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={busyBookingId !== null} onClick={() => setShowTransferDetails(false)}>Volver</Button>
            ) : paymentBooking ? (
              paymentBooking.paymentCancellationStatus ? <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setPaymentBooking(null)}>Cerrar</Button>
              : paymentBooking.paymentStatus === "approved" ? <>
                <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={busyBookingId !== null} onClick={() => setPaymentBooking(null)}>Volver</Button>
                {((paymentBooking.customer.paymentMethod !== "transferencia" && paymentBooking.customer.paymentMethod !== "efectivo") || isValidRefundDestination(refundDestinationType, refundDestination))
                  && Date.parse(`${paymentBooking.date}T${paymentBooking.time}:00-03:00`) - currentTime >= (cancellationPolicyFor(paymentBooking)?.cancellationWindowMinutes ?? 30) * 60 * 1000
                  && <Button type="button" className="w-full bg-gold text-primary-foreground hover:bg-gold-soft sm:w-auto" disabled={busyBookingId !== null} onClick={() => void cancelPayment(paymentBooking)}>
                    {busyBookingId === paymentBooking.id ? "Enviando solicitud…" : "Solicitar devolución"}
                  </Button>}
              </> : <>
                <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={busyBookingId !== null || paymentBooking.paymentReportedAt !== undefined} onClick={() => {
                  setNewPaymentMethod(paymentBooking.customer.paymentMethod ?? "efectivo");
                  setChangingPaymentBooking(paymentBooking);
                }}>Cambiar método de pago</Button>
                <Button type="button" variant="outline" className="w-full border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 sm:w-auto" disabled={busyBookingId !== null || !!paymentBooking.paymentReportedAt} onClick={() => void reportPayment(paymentBooking)}>Indicar pago realizado</Button>
                {paymentBooking.customer.paymentMethod !== "efectivo" && <Button type="button" disabled={busyBookingId !== null} className="w-full bg-gold text-primary-foreground hover:bg-gold-soft sm:w-auto" onClick={() => void payBooking(paymentBooking)}>
                  {payingBookingId === paymentBooking.id ? "Preparando pago…" : "Pagar"}
                </Button>}
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={changingPaymentBooking !== null} onOpenChange={(open) => { if (!open && !busyBookingId) setChangingPaymentBooking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar método de pago</DialogTitle>
            <DialogDescription>Podés cambiarlo mientras el profesional no haya confirmado el pago.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm text-muted-foreground">
            <span>Nuevo método</span>
            <select value={newPaymentMethod} onChange={(event) => setNewPaymentMethod(event.target.value as NonNullable<Booking["customer"]["paymentMethod"]>)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia bancaria</option>
              <option value="tarjeta o mercado pago">Tarjeta o Mercado Pago</option>
            </select>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busyBookingId !== null} onClick={() => setChangingPaymentBooking(null)}>Cancelar</Button>
            <Button type="button" disabled={!changingPaymentBooking || changingPaymentBooking.paymentStatus === "approved" || busyBookingId !== null} className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void savePaymentMethod()}>{busyBookingId === changingPaymentBooking?.id ? "Guardando…" : "Guardar método"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
