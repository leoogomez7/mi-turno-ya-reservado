import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  CalendarDays,
  Clock3,
  Copy,
  ExternalLink,
  Instagram,
  Plus,
  Scissors,
  Search,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiteHeader } from "@/components/site-header";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth-context";
import {
  canArchiveBooking,
  canDeleteBooking,
  getBookingArchiveLabel,
  hasUnresolvedPaymentReport,
  hasPaymentReportedOrApproved,
  requiresClientPaymentAcknowledgement,
  type Booking,
} from "@/lib/booking-store";
import {
  getAvailableSlotCapacities,
  isProfessionalAvailableOnDate,
  type Professional,
} from "@/lib/professional-store";
import {
  archiveBooking,
  archiveBookings,
  acknowledgeClientPaymentNotPaid,
  BOOKING_HIGHLIGHT_KEY,
  cancelClientBooking,
  cancelClientPayment,
  createClientBookingPaymentPreference,
  getClientBookings,
  permanentlyDeleteArchivedBooking,
  permanentlyDeleteArchivedBookings,
  reportClientPayment,
  restoreArchivedBooking,
  restoreArchivedBookings,
  updateClientBooking,
  updateClientPaymentMethod,
  getAvailableStores,
  type Store,
} from "@/lib/cloud-sync";
import { toast } from "sonner";
import { LoadingScreen } from "@/components/loading-screen";
import { normalizeWhatsappNumber } from "@/lib/utils";
import { noIndexMeta } from "@/lib/seo";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12.04 2a9.86 9.86 0 0 0-8.48 14.89L2 22l5.28-1.38A9.93 9.93 0 1 0 12.04 2Zm0 18.02a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.13.82.84-3.05-.2-.32a8.08 8.08 0 1 1 6.92 3.86Zm4.44-6.06c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.93-1.18-.71-.63-1.19-1.41-1.33-1.65-.14-.24-.02-.37.1-.49.1-.1.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.4h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.51.58.18 1.11.16 1.53.1.47-.07 1.43-.58 1.63-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  );
}

function isEligibleCancelledClientPayment(booking: Booking) {
  return (
    booking.status === "cancelled" &&
    booking.cancelledBy === "client" &&
    booking.clientCancellationRefundEligible === true &&
    booking.paymentReportDecision === "paid" &&
    booking.paymentStatus === "approved"
  );
}

function canRequestPaymentRefund(booking: Booking) {
  const cancelledByProfessional =
    booking.status === "cancelled" && booking.cancelledBy === "professional";
  if (booking.status === "cancelled" && booking.cancelledBy === "client")
    return isEligibleCancelledClientPayment(booking);
  return (
    booking.paymentStatus === "approved" ||
    (cancelledByProfessional && hasPaymentReportedOrApproved(booking))
  );
}

export const Route = createFileRoute("/mis-turnos")({
  head: () => ({ meta: [{ title: "Mis turnos" }, noIndexMeta] }),
  component: MyBookingsPage,
});

function MyBookingsPage() {
  const { isAuthenticated, isLoading, role, user } = useAppAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [stores, setStores] = useState<Pick<Store, "code" | "name" | "settings" | "logo">[]>([]);
  const [viewingStore, setViewingStore] = useState<Store | null>(null);
  const [occupiedSlots, setOccupiedSlots] = useState<
    Pick<Booking, "id" | "storeCode" | "barberId" | "date" | "time" | "duration" | "status">[]
  >([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  const [payingBookingId, setPayingBookingId] = useState<string | null>(null);
  const [deletingBookingId, setDeletingBookingId] = useState<string | null>(null);
  const [deletingVisibleBookings, setDeletingVisibleBookings] = useState(false);
  const [cancelingBookingId, setCancelingBookingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [editedProfessionalId, setEditedProfessionalId] = useState("");
  const [editedServiceIds, setEditedServiceIds] = useState<string[]>([]);
  const [editedDate, setEditedDate] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [editedTime, setEditedTime] = useState("");
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [bookingSearch, setBookingSearch] = useState("");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [restoringBookingId, setRestoringBookingId] = useState<string | null>(null);
  const [restoringAllArchivedBookings, setRestoringAllArchivedBookings] = useState(false);
  const [permanentlyDeletingBookingId, setPermanentlyDeletingBookingId] = useState<string | null>(
    null,
  );
  const [deletingAllArchivedBookings, setDeletingAllArchivedBookings] = useState(false);
  const [showTransferDetails, setShowTransferDetails] = useState(false);
  const [changingPaymentBooking, setChangingPaymentBooking] = useState<Booking | null>(null);
  const [newPaymentMethod, setNewPaymentMethod] =
    useState<NonNullable<Booking["customer"]["paymentMethod"]>>("efectivo");
  const [refundDestination, setRefundDestination] = useState("");
  const [refundDestinationType, setRefundDestinationType] = useState<"cbu" | "alias">("cbu");
  const lastBookingsReloadAt = useRef(0);
  const bookingsReloadInFlight = useRef<Promise<void> | null>(null);
  const bookingsMutationRevision = useRef(0);
  const suppressPaymentClick = useRef(false);
  const [highlightedBookingId, setHighlightedBookingId] = useState("");
  const highlightTimeout = useRef<number | null>(null);

  const applyBookingMutation = (update: (current: Booking[]) => Booking[]) => {
    bookingsMutationRevision.current += 1;
    setBookings(update);
  };

  const editableProfessionals = editingBooking
    ? professionals.filter((item) => item.storeCode === editingBooking.storeCode)
    : [];
  const editingProfessional = editableProfessionals.find(
    (item) => item.id === editedProfessionalId,
  );
  const editingServices = editedServiceIds
    .map((id) => editingProfessional?.services.find((service) => service.id === id))
    .filter((service) => service !== undefined);
  const editingDuration = editingServices.reduce((total, service) => total + service.duration, 0);
  const editingTotalPrice = editingServices.reduce((total, service) => total + service.price, 0);
  const availableEditSlots = useMemo(() => {
    if (
      !editingProfessional ||
      editingServices.length !== editedServiceIds.length ||
      !editingDuration ||
      !editedDate
    )
      return [];
    const date = parseISO(`${editedDate}T12:00:00`);
    if (Number.isNaN(date.getTime())) return [];
    const today = format(new Date(), "yyyy-MM-dd");
    if (editedDate < today) return [];
    const slots = getAvailableSlotCapacities(
      editingProfessional,
      date,
      editingDuration,
      occupiedSlots,
      editingBooking?.id ?? "",
      editingBooking?.storeCode,
    );
    if (editedDate !== today) return slots;
    const currentClock = format(currentTime, "HH:mm");
    return slots.filter((slot) => slot.time > currentClock);
  }, [
    editedDate,
    editingDuration,
    editedServiceIds,
    editingBooking,
    editingProfessional,
    editingServices,
    occupiedSlots,
    currentTime,
  ]);

  useEffect(() => {
    if (!editingBooking || !editedDate || !editingServices.length || !editedTime) return;
    if (!availableEditSlots.some((slot) => slot.time === editedTime)) setEditedTime("");
  }, [availableEditSlots, editedDate, editedTime, editingBooking, editingServices.length]);

  const reload = useCallback((force = false) => {
    if (bookingsReloadInFlight.current) return bookingsReloadInFlight.current;
    if (!force && Date.now() - lastBookingsReloadAt.current < 5_000) return Promise.resolve();
    const request = (async () => {
      const mutationRevision = bookingsMutationRevision.current;
      try {
        const result = await getClientBookings();
        if (mutationRevision === bookingsMutationRevision.current) {
          setBookings(result.bookings);
          setOccupiedSlots(result.occupiedSlots);
        }
        setProfessionals(result.professionals);
        setStores(result.stores);
        lastBookingsReloadAt.current = Date.now();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudieron cargar tus turnos.");
      } finally {
        setLoadingBookings(false);
        bookingsReloadInFlight.current = null;
      }
    })();
    bookingsReloadInFlight.current = request;
    return request;
  }, []);

  function openEditDialog(booking: Booking) {
    setEditingBooking(booking);
    setEditedProfessionalId(booking.barberId);
    setEditedServiceIds(booking.serviceIds.length ? booking.serviceIds : [""]);
    setEditedDate(booking.date);
    setEditedTime(booking.time);
    if (Date.now() - lastBookingsReloadAt.current >= 30_000) void reload();
  }

  useEffect(() => {
    if (!isAuthenticated || role !== "client") return;
    const refresh = () => {
      if (document.hidden) return;
      void reload(true);
    };
    refresh();
    const intervalId = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    window.addEventListener("bookings:changed", refresh);
    window.addEventListener("mi-turno-ya:cloud-ready", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("bookings:changed", refresh);
      window.removeEventListener("mi-turno-ya:cloud-ready", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
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
      window.setTimeout(
        () =>
          document
            .getElementById(`${isArchived ? "archived-" : ""}booking-${bookingId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" }),
        isArchived ? 100 : 0,
      );
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
      applyBookingMutation((current) =>
        current.map((item) => (item.id === booking.id ? result.booking : item)),
      );
      setPaymentBooking(null);
      toast.success("Aviso enviado. El profesional verificará el pago.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo avisar al profesional.");
    } finally {
      setBusyBookingId(null);
    }
  }

  async function acknowledgePaymentNotPaid(booking: Booking) {
    if (busyBookingId || !requiresClientPaymentAcknowledgement(booking)) return;
    setBusyBookingId(booking.id);
    try {
      const result = await acknowledgeClientPaymentNotPaid(booking.id);
      applyBookingMutation((current) =>
        current.map((item) => (item.id === booking.id ? result.booking : item)),
      );
      toast.success("Confirmación registrada. Ahora podés borrar el turno.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo confirmar que no realizaste el pago.",
      );
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
    if (suppressPaymentClick.current || busyBookingId || booking.paymentStatus === "approved")
      return;
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
    const cancelledByProfessional =
      booking.status === "cancelled" && booking.cancelledBy === "professional";
    const cancelledClientPayment = isEligibleCancelledClientPayment(booking);
    const policy = cancellationPolicyFor(booking);
    if (
      !cancelledByProfessional &&
      (policy?.noRefunds ||
        policy?.allowRefunds === false ||
        (policy?.refundPercent ?? 100) <= 0)
    ) {
      toast.error("La política de esta sucursal no permite devolver pagos.");
      return;
    }
    const appointmentAt = Date.parse(`${booking.date}T${booking.time}:00-03:00`);
    const windowMinutes = policy?.cancellationWindowMinutes ?? 30;
    if (!canRequestPaymentRefund(booking)) {
      toast.error(
        "Solo podés solicitar la devolución cuando el profesional haya confirmado el pago, salvo que haya cancelado un pago que el cliente informó.",
      );
      return;
    }
    if (!isValidRefundDestination(refundDestinationType, refundDestination)) {
      toast.error(
        refundDestinationType === "cbu"
          ? "Ingresá un CBU válido de 22 dígitos."
          : "Ingresá un alias válido de 6 a 30 caracteres.",
      );
      return;
    }
    if (
      !cancelledByProfessional &&
      !cancelledClientPayment &&
      (!Number.isFinite(appointmentAt) || appointmentAt - Date.now() < windowMinutes * 60 * 1000)
    ) {
      toast.error(
        `Solo podés solicitar la cancelación con al menos ${windowMinutes} minutos de anticipación.`,
      );
      return;
    }
    setBusyBookingId(booking.id);
    try {
      const result = await cancelClientPayment(
        booking.id,
        refundDestinationType,
        refundDestination.trim(),
      );
      applyBookingMutation((current) =>
        current.map((item) => (item.id === booking.id ? result.booking : item)),
      );
      setPaymentBooking(null);
      setRefundDestination("");
      toast.success(
        cancelledByProfessional || cancelledClientPayment
          ? "Solicitud de devolución enviada al profesional."
          : "Turno cancelado, horario liberado y solicitud de devolución enviada al profesional.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar el pago.");
    } finally {
      setBusyBookingId(null);
    }
  }

  function isValidRefundDestination(type: "cbu" | "alias", value: string) {
    return type === "cbu"
      ? /^\d{22}$/.test(value.replace(/\s/g, ""))
      : /^[\p{L}\d._-]{6,30}$/u.test(value.trim());
  }

  async function savePaymentMethod() {
    if (
      !changingPaymentBooking ||
      busyBookingId ||
      changingPaymentBooking.paymentReportedAt ||
      changingPaymentBooking.paymentStatus === "approved"
    )
      return;
    suppressPaymentClick.current = true;
    setBusyBookingId(changingPaymentBooking.id);
    try {
      const result = await updateClientPaymentMethod(changingPaymentBooking.id, newPaymentMethod);
      applyBookingMutation((current) =>
        current.map((item) => (item.id === changingPaymentBooking.id ? result.booking : item)),
      );
      setPaymentBooking(result.booking);
      setChangingPaymentBooking(null);
      setShowTransferDetails(false);
      toast.success("Método de pago actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el método de pago.");
    } finally {
      setBusyBookingId(null);
      window.setTimeout(() => {
        suppressPaymentClick.current = false;
      }, 600);
    }
  }

  async function saveBookingTime() {
    if (!editingBooking || busyBookingId) return;
    if (
      !editingProfessional ||
      !editedServiceIds.length ||
      editingServices.length !== editedServiceIds.length ||
      new Set(editedServiceIds).size !== editedServiceIds.length
    ) {
      toast.error("Elegí un profesional y un servicio disponibles.");
      return;
    }
    if (!editedDate || !availableEditSlots.some((slot) => slot.time === editedTime)) {
      toast.error("Elegí una fecha y un horario disponibles para los servicios seleccionados.");
      return;
    }
    setBusyBookingId(editingBooking.id);
    try {
      const result = await updateClientBooking(editingBooking.id, {
        barberId: editingProfessional.id,
        serviceIds: editedServiceIds,
        date: editedDate,
        time: editedTime,
      });
      applyBookingMutation((current) =>
        current.map((item) => (item.id === editingBooking.id ? result.booking : item)),
      );
      setEditingBooking(null);
      toast.success("Turno modificado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo modificar el turno.");
      await reload(true);
    } finally {
      setBusyBookingId(null);
    }
  }

  async function cancelBooking(booking: Booking) {
    if (busyBookingId) return;
    const policy = cancellationPolicyFor(booking);
    const reportPending = hasUnresolvedPaymentReport(booking);
    const refundCanBeRequested =
      (booking.paymentStatus === "approved" || reportPending) &&
      !policy?.noRefunds &&
      policy?.allowRefunds !== false &&
      (policy?.refundPercent ?? 100) > 0 &&
      ["efectivo", "transferencia", "tarjeta o mercado pago"].includes(
        booking.customer.paymentMethod ?? "",
      ) &&
      Date.parse(`${booking.date}T${booking.time}:00-03:00`) - Date.now() >=
        (policy?.cancellationWindowMinutes ?? 30) * 60 * 1000;
    if (refundCanBeRequested && !reportPending) {
      setRefundDestination("");
      setRefundDestinationType("cbu");
      setPaymentBooking(booking);
      setShowTransferDetails(false);
      return;
    }
    setBusyBookingId(booking.id);
    setCancelingBookingId(booking.id);
    try {
      const result = await cancelClientBooking(booking.id);
      applyBookingMutation((current) =>
        current.map((item) => (item.id === booking.id ? result.booking : item)),
      );
      toast.success(
        result.booking.clientCancellationRefundEligible && hasUnresolvedPaymentReport(result.booking)
          ? "Turno cancelado. No podrás borrarlo hasta que el profesional revise el pago informado."
          : "Turno cancelado. El horario quedó disponible y el profesional recibió el aviso.",
      );
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
      toast.error(
        "Solo se puede borrar un turno pagado, asistido, cancelado o con la devolución realizada.",
      );
      return;
    }
    setBusyBookingId(booking.id);
    setDeletingBookingId(booking.id);
    try {
      const result = await archiveBooking(booking.id);
      applyBookingMutation((current) =>
        current.map((item) => (item.id === booking.id ? result.booking : item)),
      );
      toast.success("Turno archivado. Podés consultarlo en Turnos borrados/antiguos.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo archivar el turno.");
    } finally {
      setBusyBookingId(null);
      setDeletingBookingId(null);
    }
  }

  async function archiveVisibleTurns() {
    if (busyBookingId || deletingVisibleBookings || deletingBookingId) return;
    const eligibleBookings = eligibleVisibleBookings;
    if (!eligibleBookings.length) {
      toast.error("No hay turnos disponibles para borrar en el listado actual.");
      return;
    }
    setDeletingVisibleBookings(true);
    try {
      const { bookings: archived, failedCount } = await archiveBookings(
        eligibleBookings.map((booking) => booking.id),
      );
      if (archived.length) {
        const archivedById = new Map(archived.map((booking) => [booking.id, booking]));
        applyBookingMutation((current) =>
          current.map((booking) => archivedById.get(booking.id) ?? booking),
        );
      }
      toast[failedCount ? "error" : "success"](
        failedCount
          ? `Se borraron ${archived.length} turnos; ${failedCount} no se pudieron borrar.`
          : `Se borraron ${archived.length} turnos.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron borrar los turnos.");
    } finally {
      setDeletingVisibleBookings(false);
    }
  }

  async function restoreTurn(booking: Booking) {
    if (restoringBookingId || restoringAllArchivedBookings) return;
    setRestoringBookingId(booking.id);
    try {
      const result = await restoreArchivedBooking(booking.id);
      applyBookingMutation((current) =>
        current.map((item) => (item.id === booking.id ? result.booking : item)),
      );
      toast.success("Turno restaurado en tu lista principal.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo restaurar el turno.");
    } finally {
      setRestoringBookingId(null);
    }
  }

  async function restoreAllArchivedTurns() {
    if (restoringAllArchivedBookings || restoringBookingId || !archivedBookings.length) return;
    setRestoringAllArchivedBookings(true);
    try {
      const { bookings: restoredBookings, failedCount } = await restoreArchivedBookings(
        archivedBookings.map((booking) => booking.id),
      );
      if (restoredBookings.length) {
        const restoredById = new Map(restoredBookings.map((booking) => [booking.id, booking]));
        applyBookingMutation((current) =>
          current.map((booking) => restoredById.get(booking.id) ?? booking),
        );
      }
      if (failedCount) {
        toast.error(
          `Se restauraron ${restoredBookings.length} turnos; ${failedCount} no se pudieron restaurar.`,
        );
      } else {
        toast.success(`Se restauraron ${restoredBookings.length} turnos.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron restaurar los turnos.");
    } finally {
      setRestoringAllArchivedBookings(false);
    }
  }

  async function permanentlyDeleteTurn(booking: Booking) {
    if (permanentlyDeletingBookingId || deletingAllArchivedBookings) return;
    if (!canDeleteBooking(booking)) {
      toast.error(
        "Solo se puede borrar un turno pagado, asistido, cancelado o con la devolución realizada.",
      );
      return;
    }
    setPermanentlyDeletingBookingId(booking.id);
    try {
      await permanentlyDeleteArchivedBooking(booking.id);
      applyBookingMutation((current) => current.filter((item) => item.id !== booking.id));
      toast.success("Turno eliminado definitivamente.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo borrar definitivamente el turno.",
      );
    } finally {
      setPermanentlyDeletingBookingId(null);
    }
  }

  async function permanentlyDeleteAllArchivedTurns() {
    if (permanentlyDeletingBookingId || deletingAllArchivedBookings || !archivedBookings.length)
      return;
    const deletableBookings = archivedBookings.filter(canDeleteBooking);
    if (!deletableBookings.length) {
      toast.error(
        "No hay turnos pagados, asistidos, cancelados o con la devolución realizada para borrar.",
      );
      return;
    }
    setDeletingAllArchivedBookings(true);
    let deletedCount = 0;
    let failedCount = archivedBookings.length - deletableBookings.length;
    try {
      const result = await permanentlyDeleteArchivedBookings(
        deletableBookings.map((booking) => booking.id),
      );
      deletedCount = result.bookings.length;
      failedCount += result.failedCount;
      const deletedIds = new Set(result.bookings.map((booking) => booking.id));
      if (deletedIds.size)
        applyBookingMutation((current) => current.filter((booking) => !deletedIds.has(booking.id)));
      if (failedCount) {
        toast.error(
          `Se eliminaron ${deletedCount} turnos; ${failedCount} no cumplen los requisitos para borrarse.`,
        );
      } else {
        toast.success(`Se eliminaron ${deletedCount} turnos definitivamente.`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudieron borrar los turnos seleccionados.",
      );
    } finally {
      setDeletingAllArchivedBookings(false);
    }
  }

  function cancellationPolicyFor(booking: Booking) {
    return (
      booking.cancellationPolicyAtBooking ??
      stores.find((store) => store.code === booking.storeCode)?.settings
    );
  }

  function openStoreDetails(code?: string) {
    if (!code) {
      toast.error("No se encontró el código de esta sucursal.");
      return;
    }
    const storedStore = stores.find((store) => store.code === code);
    const fullStore = getAvailableStores().find((store) => store.code === code);
    if (fullStore) {
      setViewingStore(fullStore);
    } else if (storedStore) {
      setViewingStore(storedStore);
    } else {
      toast.error("No se pudo cargar la información de esta sucursal.");
    }
  }

  const archivedBookings = bookings
    .filter(
      (booking) =>
        !booking.clientPermanentlyDeletedAt &&
        getBookingArchiveLabel(booking, currentTime, "client"),
    )
    .sort((a, b) =>
      (b.clientArchivedAt ?? `${b.date}T${b.time}`).localeCompare(
        a.clientArchivedAt ?? `${a.date}T${a.time}`,
      ),
    );
  const visibleBookings = bookings.filter(
    (booking) =>
      !booking.clientPermanentlyDeletedAt &&
      !getBookingArchiveLabel(booking, currentTime, "client"),
  );
  const normalizeSearch = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase("es-AR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const filterBookings = (list: Booking[], query: string) => {
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return list;
    return list.filter((booking) => {
      const professional =
        professionals.find(
          (item) => item.id === booking.barberId && item.storeCode === booking.storeCode,
        ) ?? professionals.find((item) => item.id === booking.barberId);
      const serviceNames = booking.serviceIds
        .map((id) => professional?.services.find((service) => service.id === id)?.name ?? "")
        .join(" ");
      const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
      const searchable = [
        booking.customer.fullName,
        booking.customer.email,
        booking.customer.phone,
        professional?.name,
        professional?.specialty,
        stores.find((store) => store.code === booking.storeCode)?.name,
        serviceNames,
        booking.date,
        booking.time,
        format(appointmentDate, "EEEE d 'de' MMMM yyyy", { locale: es }),
        booking.customer.paymentMethod,
        booking.status,
        booking.id,
      ]
        .filter(Boolean)
        .join(" ");
      const normalized = normalizeSearch(searchable);
      return terms.every((term) => normalized.includes(term));
    });
  };
  const filteredVisibleBookings = filterBookings(visibleBookings, bookingSearch);
  const filteredArchivedBookings = filterBookings(archivedBookings, archiveSearch);
  const eligibleVisibleBookings = filteredVisibleBookings.filter(canArchiveBooking);

  if (isLoading) return <LoadingScreen message="Buscando tus turnos" />;
  if (!isAuthenticated || role !== "client")
    return (
      <>
        <SiteHeader />
        <AuthRequired role="client" title="Mis turnos" />
      </>
    );

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
              <Button
                type="button"
                variant="outline"
                className="h-9 min-w-0 whitespace-nowrap px-2 text-[11px] sm:px-4 sm:text-sm"
                onClick={() => setArchiveDialogOpen(true)}
              >
                Turnos borrados/antiguos
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-9 min-w-0 whitespace-nowrap px-2 text-[11px] sm:px-4 sm:text-sm"
                disabled={
                  deletingVisibleBookings ||
                  busyBookingId !== null ||
                  !eligibleVisibleBookings.length
                }
                onClick={() => void archiveVisibleTurns()}
              >
                {deletingVisibleBookings
                  ? "Borrando turnos..."
                  : `Borrar turnos (${eligibleVisibleBookings.length})`}
              </Button>
            </div>
          </div>
          <label className="relative mb-4 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={bookingSearch}
              onChange={(event) => setBookingSearch(event.target.value)}
              placeholder="Buscar turno..."
              className="pl-9"
              aria-label="Buscar mis turnos"
            />
          </label>
          {loadingBookings ? (
            <p className="text-sm text-muted-foreground">Cargando tus turnos…</p>
          ) : !filteredVisibleBookings.length ? (
            <p className="text-sm text-muted-foreground">
              {visibleBookings.length
                ? "No encontramos turnos con esa búsqueda."
                : "No hay turnos reservados."}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredVisibleBookings.map((booking) => {
                const professional =
                  professionals.find(
                    (item) => item.id === booking.barberId && item.storeCode === booking.storeCode,
                  ) ?? professionals.find((item) => item.id === booking.barberId);
                const storeName =
                  stores.find((store) => store.code === booking.storeCode)?.name ??
                  booking.storeCode ??
                  "Sucursal";
                const serviceNames = booking.serviceIds
                  .map((id) => professional?.services.find((service) => service.id === id)?.name)
                  .filter(Boolean)
                  .join(", ");
                const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
                const statusLabel =
                  booking.status === "completed"
                    ? "Asistió"
                    : booking.status === "no-show"
                      ? "No asistió"
                      : booking.status === "cancelled"
                        ? booking.cancelledBy === "professional"
                          ? "Cancelado por el profesional"
                          : "Cancelado por el cliente"
                        : "Reservado";
                const statusClass =
                  booking.status === "completed"
                    ? "border-emerald-300 text-emerald-400"
                    : booking.status === "cancelled" || booking.status === "no-show"
                      ? "border-red-500/30 bg-red-500/10 text-red-300"
                      : "border-gold/40 text-gold";
                const paymentMethodLabel =
                  booking.customer.paymentMethod === "efectivo"
                    ? "Efectivo"
                    : booking.customer.paymentMethod === "transferencia"
                      ? "Transferencia bancaria"
                      : booking.customer.paymentMethod === "tarjeta o mercado pago"
                        ? "Tarjeta o Mercado Pago"
                        : "No especificado";
                const policy = cancellationPolicyFor(booking);
                const cancelledByProfessional =
                  booking.status === "cancelled" && booking.cancelledBy === "professional";
                const professionalCancellationNeedsRefund =
                  cancelledByProfessional && hasPaymentReportedOrApproved(booking);
                const refundNotAllowed =
                  !professionalCancellationNeedsRefund &&
                  (policy?.noRefunds ||
                    policy?.allowRefunds === false ||
                    (policy?.refundPercent ?? 100) <= 0);
                const refundPercent = professionalCancellationNeedsRefund
                  ? 100
                  : (policy?.refundPercent ?? 100);
                const refundWindowMinutes = policy?.cancellationWindowMinutes ?? 30;
                const isActiveBooking =
                  booking.status === "confirmed" || booking.status === "pending-payment";
                const cancelledClientPayment = isEligibleCancelledClientPayment(booking);
                const needsPaymentAcknowledgement =
                  requiresClientPaymentAcknowledgement(booking);
                const hasPaymentReport =
                  Boolean(booking.paymentReportedAt) || booking.paymentStatus === "approved";
                const refundRequestTooLate =
                  !Number.isFinite(Date.parse(`${booking.date}T${booking.time}:00-03:00`)) ||
                  Date.parse(`${booking.date}T${booking.time}:00-03:00`) - currentTime <
                    (policy?.cancellationWindowMinutes ?? 30) * 60 * 1000;
                const appointmentAlreadyStarted =
                  !Number.isFinite(Date.parse(`${booking.date}T${booking.time}:00-03:00`)) ||
                  Date.parse(`${booking.date}T${booking.time}:00-03:00`) <= currentTime;
                const canCancel =
                  isActiveBooking &&
                  !appointmentAlreadyStarted &&
                  !booking.paymentCancellationStatus &&
                  ["efectivo", "transferencia", "tarjeta o mercado pago"].includes(
                    booking.customer.paymentMethod ?? "",
                  );
                const canRequestPaymentCancellation =
                  (isActiveBooking ||
                    cancelledByProfessional ||
                    cancelledClientPayment) &&
                  canRequestPaymentRefund(booking) &&
                  !refundNotAllowed &&
                  (booking.cancelledBy === "professional" ||
                    cancelledClientPayment ||
                    !refundRequestTooLate) &&
                  ["efectivo", "transferencia", "tarjeta o mercado pago"].includes(
                    booking.customer.paymentMethod ?? "",
                  );
                const canArchive = !getBookingArchiveLabel(booking, currentTime, "client");
                return (
                  <article
                    key={booking.id}
                    id={`booking-${booking.id}`}
                    className={`flex flex-col items-stretch gap-3 rounded-xl border p-4 text-center transition-colors duration-300 xl:grid xl:grid-cols-[4.5rem_minmax(12rem,1fr)_auto_minmax(14rem,0.8fr)_minmax(22rem,1.3fr)] xl:items-center xl:gap-4 xl:text-left ${highlightedBookingId === booking.id ? "border-gold bg-gold/20 ring-2 ring-gold/70" : "border-gold/30 bg-card"}`}
                  >
                    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 xl:contents">
                      <div className="flex w-18 shrink-0 flex-col items-center rounded-lg bg-gold/10 px-1.5 py-2 text-gold xl:col-start-1 xl:row-start-1">
                        <span className="text-[10px] uppercase tracking-widest">
                          {format(appointmentDate, "EEE", { locale: es })}
                        </span>
                        <span className="font-display text-xl font-semibold">
                          {format(appointmentDate, "dd/MM")}
                        </span>
                        <span className="text-[10px]">{booking.time}</span>
                      </div>
                      <div className="min-w-0 text-center xl:col-start-2 xl:row-start-1 xl:text-left">
                        <div className="font-medium">{professional?.name ?? "Profesional"}</div>
                        <div className="text-sm text-muted-foreground">
                          {serviceNames || "Servicio"} · {booking.duration} min
                        </div>
                        <button
                          type="button"
                          className="text-xs font-medium text-gold underline-offset-4 hover:underline"
                          onClick={() => openStoreDetails(booking.storeCode)}
                        >
                          Sucursal: {storeName}
                        </button>
                      </div>
                    </div>
                    <div className="mx-auto w-fit rounded-lg border border-gold/20 bg-gold/5 px-3 py-2 text-center font-display text-lg font-semibold text-gold xl:col-start-3 xl:row-start-1 xl:mx-0 xl:text-lg">
                      ${booking.totalPrice.toLocaleString("es-AR")}
                    </div>
                    <div className="flex w-full flex-col items-center gap-1 text-xs text-muted-foreground xl:col-start-4 xl:items-start xl:justify-self-start">
                      <Badge variant="outline" className="border-gold/30 text-gold">
                        Pago · {paymentMethodLabel}
                      </Badge>
                      {booking.paymentAdjustmentMode && booking.paymentAdjustmentMode !== "none" && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-400">
                          {booking.paymentAdjustmentMode === "discount" ? "Descuento" : "Recargo"} por pago · {booking.paymentAdjustmentPercent ?? 0}%
                        </Badge>
                      )}
                      {booking.couponCode && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-400">
                          Cupón {booking.couponCode} · −${(booking.couponDiscountAmount ?? 0).toLocaleString("es-AR")}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={
                          refundNotAllowed
                            ? "border-red-300 text-red-300"
                            : "border-gold/30 text-gold"
                        }
                      >
                        {professionalCancellationNeedsRefund
                          ? "Devolución 100% por cancelación del profesional"
                          : refundNotAllowed
                          ? "Política devolución - No"
                          : `Política devolución - ${refundPercent}% - Hasta ${refundWindowMinutes} minutos`}
                      </Badge>
                      {(booking.status === "pending-payment" ||
                        booking.paymentStatus === "pending" ||
                        (isActiveBooking &&
                          booking.customer.paymentMethod === "efectivo" &&
                          booking.paymentStatus !== "approved")) && (
                        <Badge variant="outline" className="border-amber-300 text-amber-300">
                          Pago pendiente
                        </Badge>
                      )}
                      {booking.paymentReportDecision === "not-paid" && (
                        <Badge variant="outline" className="border-amber-300 text-amber-300">
                          El profesional indicó que el pago no se recibió
                        </Badge>
                      )}
                      {booking.clientPaymentReportAcknowledgedAt && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-400">
                          Confirmaste que no realizaste el pago
                        </Badge>
                      )}
                      {booking.paymentReportedAt && booking.paymentStatus !== "approved" && (
                        <Badge variant="outline" className="border-amber-300 text-amber-300">
                          Informaste el pago · El profesional lo revisará
                        </Badge>
                      )}
                      {booking.status === "cancelled" &&
                        booking.cancelledBy === "client" &&
                        booking.clientCancellationRefundEligible === true &&
                        hasUnresolvedPaymentReport(booking) && (
                          <Badge variant="outline" className="border-amber-300 text-amber-300">
                            No podrás borrar el turno hasta que el profesional revise el pago
                          </Badge>
                        )}
                      {booking.paymentStatus === "approved" && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-400">
                          Pago confirmado
                        </Badge>
                      )}
                      {booking.paymentCancellationStatus === "requested" && (
                        <Badge variant="outline" className="border-amber-300 text-amber-300">
                          Devolución solicitada
                        </Badge>
                      )}
                      {booking.paymentCancellationStatus === "refunded" && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-400">
                          Pago devuelto
                        </Badge>
                      )}
                      {booking.paymentCancellationStatus === "cancelled" && (
                        <Badge variant="outline" className="border-red-300 text-red-300">
                          Pago cancelado
                        </Badge>
                      )}
                      {(booking.status === "completed" || booking.status === "no-show") && (
                        <Badge variant="outline" className={statusClass}>
                          {statusLabel}
                        </Badge>
                      )}
                      {booking.status === "cancelled" && (
                        <Badge variant="outline" className={statusClass}>
                          {statusLabel}
                        </Badge>
                      )}
                      {booking.status === "cancelled" && refundNotAllowed && (
                        <Badge variant="outline" className="border-red-300 text-red-300">
                          Devolución no permitida
                        </Badge>
                      )}
                    </div>
                    {(isActiveBooking ||
                      canRequestPaymentCancellation ||
                      needsPaymentAcknowledgement ||
                      (canArchive && canArchiveBooking(booking))) && (
                      <div className="flex w-full flex-wrap justify-center gap-2 xl:col-start-5 xl:grid xl:grid-cols-3">
                        {isActiveBooking &&
                          !hasPaymentReport &&
                          booking.paymentStatus !== "approved" && (
                            <Button
                              size="sm"
                              disabled={busyBookingId !== null}
                              className="min-w-0 whitespace-normal px-2 text-center leading-tight bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60"
                              onClick={() => {
                                setPaymentBooking(booking);
                                setShowTransferDetails(false);
                              }}
                            >
                              Indicar pago
                            </Button>
                          )}
                        {canRequestPaymentCancellation &&
                          !booking.paymentCancellationStatus &&
                          booking.status === "cancelled" &&
                          (booking.cancelledBy === "professional" || cancelledClientPayment) && (
                            <Button
                              size="sm"
                              className="min-w-0 whitespace-normal px-2 text-center leading-tight bg-gold text-primary-foreground hover:bg-gold-soft"
                              disabled={busyBookingId !== null}
                              onClick={() => {
                                setRefundDestination("");
                                setRefundDestinationType("cbu");
                                setPaymentBooking(booking);
                                setShowTransferDetails(false);
                              }}
                            >
                              Solicitar devolución
                            </Button>
                          )}
                        {needsPaymentAcknowledgement && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-w-0 whitespace-normal border-gold/40 px-2 text-center leading-tight text-gold"
                            disabled={busyBookingId !== null}
                            onClick={() => void acknowledgePaymentNotPaid(booking)}
                          >
                            {busyBookingId === booking.id
                              ? "Procesando..."
                              : "Confirmar que no pagué"}
                          </Button>
                        )}
                        {isActiveBooking &&
                          booking.paymentStatus !== "approved" &&
                          !hasPaymentReport &&
                          !booking.paymentCancellationStatus && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-w-0 whitespace-normal px-2 text-center leading-tight"
                              disabled={busyBookingId !== null}
                              onClick={() => openEditDialog(booking)}
                            >
                              Modificar turno
                            </Button>
                          )}
                        {canCancel && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className={`min-w-0 whitespace-normal px-2 text-center leading-tight ${cancelingBookingId === booking.id ? "opacity-60" : ""}`}
                            disabled={busyBookingId !== null}
                            onClick={() => void cancelBooking(booking)}
                          >
                            {cancelingBookingId === booking.id
                              ? "Cancelando turno..."
                              : "Cancelar turno"}
                          </Button>
                        )}
                        {canArchive && canArchiveBooking(booking) && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className={`min-w-0 whitespace-normal px-2 text-center leading-tight ${deletingBookingId === booking.id ? "opacity-60" : ""}`}
                            disabled={busyBookingId !== null}
                            onClick={() => void archiveTurn(booking)}
                          >
                            {deletingBookingId === booking.id
                              ? "Borrando turno..."
                              : "Borrar turno"}
                          </Button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
      <Dialog
        open={editingBooking !== null}
        onOpenChange={(open) => {
          if (!open && !busyBookingId) setEditingBooking(null);
        }}
      >
        <DialogContent className="gold-scrollbar mobile-dialog-scrollbar-hidden w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Modificar turno</DialogTitle>
            <DialogDescription>
              Elegí profesional, servicio, fecha y horario. Revisaremos la disponibilidad antes de
              guardar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <label className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-gold" />
                Profesional
              </span>
              <Select
                value={editedProfessionalId}
                onValueChange={(nextProfessionalId) => {
                  const nextProfessional = editableProfessionals.find(
                    (item) => item.id === nextProfessionalId,
                  );
                  setEditedProfessionalId(nextProfessionalId);
                  setEditedServiceIds(
                    nextProfessional?.services[0] ? [nextProfessional.services[0].id] : [],
                  );
                  setEditedDate("");
                  setEditedTime("");
                }}
              >
                <SelectTrigger className="w-full bg-background text-white data-placeholder:text-white">
                  <SelectValue placeholder="Seleccionar profesional" />
                </SelectTrigger>
                <SelectContent className="gold-scrollbar max-h-60">
                  {editableProfessionals.map((professional) => (
                    <SelectItem key={professional.id} value={professional.id}>
                      {professional.name}
                      {professional.specialty ? ` · ${professional.specialty}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Scissors className="h-4 w-4 text-gold" />
                Servicios
              </span>
              {editedServiceIds.map((serviceId, index) => (
                <div key={`${index}-${serviceId}`} className="flex items-center gap-2">
                  <Select
                    value={serviceId}
                    onValueChange={(value) => {
                      setEditedServiceIds((current) =>
                        current.map((id, itemIndex) => (itemIndex === index ? value : id)),
                      );
                      setEditedTime("");
                    }}
                    disabled={!editingProfessional}
                  >
                    <SelectTrigger
                      aria-label={`Servicio ${index + 1}`}
                      className="min-w-0 flex-1 bg-background text-white data-placeholder:text-white"
                    >
                      <SelectValue placeholder="Seleccionar servicio" />
                    </SelectTrigger>
                    <SelectContent className="gold-scrollbar max-h-60">
                      {(editingProfessional?.services ?? [])
                        .filter(
                          (service) =>
                            service.id === serviceId || !editedServiceIds.includes(service.id),
                        )
                        .map((service) => (
                          <SelectItem key={service.id} value={service.id}>
                            {service.name} · {service.duration} min · $
                            {service.price.toLocaleString("es-AR")}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {editedServiceIds.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label={`Quitar servicio ${index + 1}`}
                      onClick={() => {
                        setEditedServiceIds((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        );
                        setEditedTime("");
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  !editingProfessional ||
                  editedServiceIds.length >= (editingProfessional?.services.length ?? 0)
                }
                onClick={() => {
                  const nextService = editingProfessional?.services.find(
                    (service) => !editedServiceIds.includes(service.id),
                  );
                  if (nextService) setEditedServiceIds((current) => [...current, nextService.id]);
                  setEditedTime("");
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                Agregar servicio
              </Button>
              {editingServices.length > 0 && (
                <p className="text-xs">
                  Duración total: {editingDuration} min · Total:{" "}
                  <span className="font-semibold text-gold">
                    ${editingTotalPrice.toLocaleString("es-AR")}
                  </span>
                </p>
              )}
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-gold" />
                Fecha
              </span>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between font-normal text-white hover:text-white"
                    disabled={!editingProfessional || !editingServices.length}
                  >
                    <span>
                      {editedDate
                        ? format(parseISO(`${editedDate}T12:00:00`), "dd/MM/yyyy", { locale: es })
                        : "Seleccionar fecha"}
                    </span>
                    <CalendarDays className="h-4 w-4 text-gold" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="gold-scrollbar w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    locale={es}
                    selected={editedDate ? parseISO(`${editedDate}T12:00:00`) : undefined}
                    onSelect={(date) => {
                      setEditedDate(date ? format(date, "yyyy-MM-dd") : "");
                      setEditedTime("");
                      setDatePickerOpen(false);
                    }}
                    disabled={(date) =>
                      format(date, "yyyy-MM-dd") < format(new Date(), "yyyy-MM-dd") ||
                      !editingProfessional ||
                      !isProfessionalAvailableOnDate(editingProfessional, date)
                    }
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <label className="space-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-gold" />
                Horario
              </span>
              <Select
                value={editedTime}
                onValueChange={setEditedTime}
                disabled={!editedDate || !editingProfessional}
              >
                <SelectTrigger className="w-full bg-background text-white data-placeholder:text-white disabled:opacity-100 disabled:text-white">
                  <SelectValue placeholder="Seleccionar horario" />
                </SelectTrigger>
                <SelectContent className="gold-scrollbar max-h-60">
                  {availableEditSlots.map((slot) => (
                    <SelectItem key={slot.time} value={slot.time}>
                      {slot.time} · {slot.available}{" "}
                      {slot.available === 1 ? "turno disponible" : "turnos disponibles"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editedDate && editingServices.length > 0 && !availableEditSlots.length && (
                <span className="block text-xs">
                  No hay horarios disponibles para los servicios seleccionados en esa fecha.
                </span>
              )}
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyBookingId !== null}
              onClick={() => setEditingBooking(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!editingBooking || busyBookingId !== null}
              className="bg-gold text-primary-foreground hover:bg-gold-soft"
              onClick={() => void saveBookingTime()}
            >
              {busyBookingId === editingBooking?.id ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent
          className="gold-scrollbar archive-dialog-scrollbar max-h-[85vh] overflow-y-auto sm:max-w-2xl"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Turnos borrados/antiguos</DialogTitle>
            <DialogDescription>
              Turnos archivados manualmente o antiguos. Podés restaurarlos o borrarlos
              definitivamente del listado.
            </DialogDescription>
          </DialogHeader>
          {archivedBookings.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Restaurar o borrar todos los turnos archivados, aunque haya una búsqueda activa.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    restoringAllArchivedBookings ||
                    restoringBookingId !== null ||
                    deletingAllArchivedBookings
                  }
                  onClick={() => void restoreAllArchivedTurns()}
                >
                  {restoringAllArchivedBookings ? "Restaurando…" : "Restaurar todos"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={
                    restoringAllArchivedBookings ||
                    deletingAllArchivedBookings ||
                    permanentlyDeletingBookingId !== null
                  }
                  onClick={() => void permanentlyDeleteAllArchivedTurns()}
                >
                  {deletingAllArchivedBookings ? "Borrando…" : "Borrar todos"}
                </Button>
              </div>
            </div>
          )}
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={archiveSearch}
              onChange={(event) => setArchiveSearch(event.target.value)}
              placeholder="Buscar en los turnos archivados…"
              className="pl-9"
              aria-label="Buscar turnos archivados"
            />
          </label>
          {!filteredArchivedBookings.length ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              {archivedBookings.length
                ? "No encontramos turnos con esa búsqueda."
                : "Todavía no hay turnos archivados."}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredArchivedBookings.map((booking) => {
                const professional =
                  professionals.find(
                    (item) => item.id === booking.barberId && item.storeCode === booking.storeCode,
                  ) ?? professionals.find((item) => item.id === booking.barberId);
                const storeName =
                  stores.find((store) => store.code === booking.storeCode)?.name ??
                  booking.storeCode ??
                  "Sucursal";
                const serviceNames = booking.serviceIds
                  .map((id) => professional?.services.find((service) => service.id === id)?.name)
                  .filter(Boolean)
                  .join(", ");
                const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
                const paymentMethod =
                  booking.customer.paymentMethod === "transferencia"
                    ? "Transferencia bancaria"
                    : booking.customer.paymentMethod === "tarjeta o mercado pago"
                      ? "Tarjeta o Mercado Pago"
                      : booking.customer.paymentMethod === "efectivo"
                        ? "Efectivo"
                        : "No especificado";
                const policy = cancellationPolicyFor(booking);
                const cancelledByProfessional =
                  booking.status === "cancelled" && booking.cancelledBy === "professional";
                const professionalCancellationNeedsRefund =
                  cancelledByProfessional && hasPaymentReportedOrApproved(booking);
                const refundNotAllowed =
                  !professionalCancellationNeedsRefund &&
                  (policy?.noRefunds ||
                    policy?.allowRefunds === false ||
                    (policy?.refundPercent ?? 100) <= 0);
                const refundPercent = professionalCancellationNeedsRefund
                  ? 100
                  : (policy?.refundPercent ?? 100);
                const refundWindowMinutes = policy?.cancellationWindowMinutes ?? 30;
                return (
                  <article
                    key={booking.id}
                    id={`archived-booking-${booking.id}`}
                    className={`rounded-xl border p-3 text-sm transition-colors duration-300 ${highlightedBookingId === booking.id ? "border-gold bg-gold/20 ring-2 ring-gold/70" : "border-border bg-card"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold">
                        {professional?.name ?? "Profesional"} · {serviceNames || "Servicio"}
                      </p>
                      <Badge variant="outline" className="border-gold/40 text-gold">
                        {getBookingArchiveLabel(booking, currentTime, "client")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {format(appointmentDate, "EEEE d 'de' MMMM, yyyy", { locale: es })} ·{" "}
                      {booking.time}
                    </p>
                    <button
                      type="button"
                      className="mt-1 font-medium text-gold underline-offset-4 hover:underline"
                      onClick={() => openStoreDetails(booking.storeCode)}
                    >
                      Sucursal: {storeName}
                    </button>
                    <p className="mt-1 text-muted-foreground">
                      Pago: {paymentMethod} · ${booking.totalPrice.toLocaleString("es-AR")}
                    </p>
                    <Badge
                      variant="outline"
                      className={`mt-2 ${refundNotAllowed ? "border-red-300 text-red-300" : "border-gold/30 text-gold"}`}
                    >
                      {professionalCancellationNeedsRefund
                        ? "Devolución 100% por cancelación del profesional"
                        : refundNotAllowed
                        ? "Política devolución - No"
                        : `Política devolución - ${refundPercent}% - Hasta ${refundWindowMinutes} minutos`}
                    </Badge>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          restoringBookingId !== null ||
                          restoringAllArchivedBookings ||
                          deletingAllArchivedBookings
                        }
                        onClick={() => void restoreTurn(booking)}
                      >
                        {restoringBookingId === booking.id ? "Restaurando…" : "Restaurar"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={
                          permanentlyDeletingBookingId !== null ||
                          restoringAllArchivedBookings ||
                          deletingAllArchivedBookings ||
                          !canDeleteBooking(booking)
                        }
                        onClick={() => void permanentlyDeleteTurn(booking)}
                      >
                        {permanentlyDeletingBookingId === booking.id ? "Borrando…" : "Borrar turno"}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiveDialogOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={viewingStore !== null}
        onOpenChange={(open) => !open && setViewingStore(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {viewingStore && (
            <>
              <DialogHeader>
                <DialogTitle>{viewingStore.name}</DialogTitle>
                <DialogDescription>
                  Información de la sucursal · Código de reserva: {viewingStore.code}
                </DialogDescription>
              </DialogHeader>
              {viewingStore.settings.coverImage && (
                <img
                  src={viewingStore.settings.coverImage}
                  alt={`Portada de ${viewingStore.name}`}
                  className="aspect-240/43 w-full rounded-xl object-cover"
                />
              )}
              <div className="flex min-w-0 items-center gap-4">
                {viewingStore.logo && (
                  <img
                    src={viewingStore.logo}
                    alt={`Logo de ${viewingStore.name}`}
                    className="h-16 w-16 shrink-0 rounded-full border border-gold/30 bg-background object-contain p-1"
                  />
                )}
                <div className="flex flex-wrap items-center gap-3">
                  {viewingStore.settings.googleMapsUrl && (
                    <a
                      href={viewingStore.settings.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-gold underline-offset-4 hover:underline"
                    >
                      {typeof viewingStore.settings.googleRating === "number" && (
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <Star className="h-4 w-4 fill-current" />
                          {viewingStore.settings.googleRating.toFixed(1)}
                        </span>
                      )}
                      Ver ubicación
                      {viewingStore.settings.googleReviewCount > 0 && (
                        <span>({viewingStore.settings.googleReviewCount} reseñas)</span>
                      )}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {viewingStore.settings.googleReviewUrl && (
                    <a
                      href={viewingStore.settings.googleReviewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-gold underline-offset-4 hover:underline"
                    >
                      Escribir una reseña <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                {(viewingStore.settings.instagram.trim() ||
                  normalizeWhatsappNumber(viewingStore.settings.whatsapp)) && (
                  <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
                    {viewingStore.settings.instagram.trim() && (
                      <a
                        href={`https://www.instagram.com/${viewingStore.settings.instagram.trim().replace(/^@/, "")}/`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Instagram de ${viewingStore.name}`}
                        title="Instagram"
                        className="text-gold transition-colors hover:text-gold-soft"
                      >
                        <Instagram className="h-6 w-6" />
                      </a>
                    )}
                    {normalizeWhatsappNumber(viewingStore.settings.whatsapp) && (
                      <a
                        href={`https://wa.me/${normalizeWhatsappNumber(viewingStore.settings.whatsapp)}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`WhatsApp de ${viewingStore.name}`}
                        title="WhatsApp"
                        className="text-gold transition-colors hover:text-gold-soft"
                      >
                        <WhatsAppIcon className="h-6 w-6" />
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                {professionals.some(
                  (professional) => professional.storeCode === viewingStore.code,
                ) && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Equipo
                    </p>
                    <p className="mt-1 font-medium">
                      {professionals
                        .filter((professional) => professional.storeCode === viewingStore.code)
                        .map((professional) => professional.name.trim())
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                )}
                {viewingStore.settings.address && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Ubicación
                    </p>
                    <p className="mt-1 text-sm">{viewingStore.settings.address}</p>
                  </div>
                )}
                {viewingStore.settings.description && (
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Sobre la sucursal
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">
                      {viewingStore.settings.description}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={paymentBooking !== null}
        onOpenChange={(open) => {
          if (!open && !busyBookingId) {
            setPaymentBooking(null);
            setShowTransferDetails(false);
          }
        }}
      >
        <DialogContent className={showTransferDetails ? "sm:max-w-lg" : "sm:max-w-2xl"}>
          <DialogHeader>
            <DialogTitle>
              {showTransferDetails
                ? "Datos para la transferencia"
                : paymentBooking?.paymentCancellationStatus
                  ? "Solicitud enviada"
                  : paymentBooking && canRequestPaymentRefund(paymentBooking)
                      ? (paymentBooking.status === "cancelled" &&
                          (paymentBooking.cancelledBy === "professional" ||
                            isEligibleCancelledClientPayment(paymentBooking)))
                      ? "Solicitar devolución"
                      : "Cancelar turno y solicitar devolución"
                    : "Confirmar pago"}
            </DialogTitle>
            <DialogDescription>
              {showTransferDetails
                ? `Realizá la transferencia bancaria.`
                : paymentBooking?.paymentCancellationStatus
                  ? "La solicitud quedó registrada. El turno está cancelado y el horario disponible; el profesional confirmará la devolución."
                  : paymentBooking && canRequestPaymentRefund(paymentBooking)
                    ? paymentBooking.status === "cancelled" &&
                      paymentBooking.cancelledBy === "professional"
                      ? "El profesional canceló el turno, por lo que corresponde devolver el 100% del pago. Enviá tus datos para que gestione la devolución."
                      : isEligibleCancelledClientPayment(paymentBooking)
                        ? "El turno ya está cancelado. El profesional confirmó que recibió el pago informado; enviá tus datos para solicitar la devolución según la política."
                      : "Al enviar la solicitud, el turno se cancelará y el horario quedará disponible. El profesional recibirá el aviso para gestionar la devolución."
                    : "Revisá el método de pago elegido y seleccioná cómo querés continuar."}
            </DialogDescription>
          </DialogHeader>
          {paymentBooking && showTransferDetails ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
              {(() => {
                const settings = stores.find(
                  (store) => store.code === paymentBooking.storeCode,
                )?.settings;
                const cbu = settings?.transferCbu?.trim() ?? "";
                const alias = settings?.transferAlias?.trim() ?? "";
                const copyableLabel = cbu ? "CBU" : alias ? "Alias" : null;
                const details = [
                  { label: "Titular", value: settings?.transferHolder ?? "" },
                  { label: "Banco", value: settings?.transferBank ?? "" },
                  { label: "CBU", value: cbu },
                  { label: "Alias", value: alias },
                ];
                return (
                  <>
                    {details.map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <p className="break-all font-medium">{value || "No informado"}</p>
                        </div>
                        {label === copyableLabel && value && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Copiar ${label}`}
                            onClick={() => void copyPaymentDetail(value)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <p className="border-t border-border pt-3 font-semibold text-gold">
                      Total a pagar: ${paymentBooking.totalPrice.toLocaleString("es-AR")}
                    </p>
                  </>
                );
              })()}
            </div>
          ) : paymentBooking && paymentBooking.paymentCancellationStatus ? (
            <div className="space-y-2 rounded-xl border border-amber-300/30 bg-amber-300/5 p-4 text-sm">
              <p className="font-medium text-amber-200">
                La solicitud de devolución ya fue enviada. El turno está cancelado y el horario
                quedó disponible.
              </p>
              {paymentBooking.refundDestination && (
                <p>
                  {paymentBooking.refundDestinationType === "alias"
                    ? "Alias informado"
                    : "CBU informado"}
                  :{" "}
                  <span className="font-mono text-foreground">
                    {paymentBooking.refundDestination}
                  </span>
                </p>
              )}
            </div>
          ) : paymentBooking && canRequestPaymentRefund(paymentBooking) ? (
            <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm">
              {(() => {
                const policy = cancellationPolicyFor(paymentBooking);
                const cancelledByProfessional =
                  paymentBooking.status === "cancelled" &&
                  paymentBooking.cancelledBy === "professional";
                const cancelledClientPayment = isEligibleCancelledClientPayment(paymentBooking);
                const percent = cancelledByProfessional ? 100 : (policy?.refundPercent ?? 100);
                const amount = Math.round((paymentBooking.totalPrice * percent) / 100);
                return (
                  <p className="font-medium text-gold">
                    {cancelledByProfessional
                      ? "Devolución por cancelación del profesional"
                      : "Política de devolución"}
                    : {percent}% · Importe estimado: $
                    {amount.toLocaleString("es-AR")}.
                  </p>
                );
              })()}
              <p>
                {paymentBooking.customer.paymentMethod === "tarjeta o mercado pago"
                  ? "La devolución se gestionará por Mercado Pago o tarjeta. Ingresá también un CBU o alias como alternativa por si surge algún inconveniente."
                  : "Ingresá el dato donde el profesional debe devolver el dinero. Indicá si es CBU o alias."}{" "}
                {cancelledByProfessional
                  ? "Como el profesional canceló el turno, corresponde devolver el 100% del importe."
                  : cancelledClientPayment
                    ? "El turno ya está cancelado; esta solicitud no lo volverá a cancelar."
                  : "Al enviar la solicitud, el turno se cancela y el horario queda disponible; recibirás un aviso cuando el profesional confirme la devolución."}
              </p>
              <label className="grid gap-2 text-muted-foreground">
                <span>Seleccionar CBU/Alias {paymentBooking.customer.paymentMethod === "tarjeta o mercado pago" ? "(alternativa)" : ""}</span>
                <select
                  value={refundDestinationType}
                  onChange={(event) => {
                    setRefundDestinationType(event.target.value as "cbu" | "alias");
                    setRefundDestination("");
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                >
                  <option value="cbu">CBU (22 dígitos)</option>
                  <option value="alias">Alias</option>
                </select>
                <span>
                  {refundDestinationType === "cbu"
                    ? "CBU para recibir la devolución"
                    : "Alias para recibir la devolución"}
                </span>
                <input
                  value={refundDestination}
                  onChange={(event) =>
                    setRefundDestination(
                      refundDestinationType === "cbu"
                        ? event.target.value.replace(/\D/g, "").slice(0, 22)
                        : event.target.value.slice(0, 30),
                    )
                  }
                  inputMode={refundDestinationType === "cbu" ? "numeric" : "text"}
                  autoComplete="off"
                  placeholder={refundDestinationType === "cbu" ? "22 dígitos" : "ejemplo.alias"}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-foreground"
                  aria-label={`${refundDestinationType === "cbu" ? "CBU" : "Alias"} para la devolución`}
                />
              </label>
              {(() => {
                const minutesRemaining =
                  (Date.parse(`${paymentBooking.date}T${paymentBooking.time}:00-03:00`) -
                    currentTime) /
                  60_000;
                const windowMinutes =
                  cancellationPolicyFor(paymentBooking)?.cancellationWindowMinutes ?? 30;
                const cancelledByProfessional =
                  paymentBooking.status === "cancelled" &&
                  paymentBooking.cancelledBy === "professional";
                const cancelledClientPayment = isEligibleCancelledClientPayment(paymentBooking);
                return !cancelledByProfessional &&
                  !cancelledClientPayment &&
                  minutesRemaining < windowMinutes ? (
                  <p role="alert" className="text-red-300">
                    La solicitud solo está disponible con al menos {windowMinutes} minutos de
                    anticipación.
                  </p>
                ) : null;
              })()}
            </div>
          ) : paymentBooking ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
              <p>
                Método de pago:{" "}
                <span className="font-medium text-gold">
                  {paymentBooking.customer.paymentMethod === "transferencia"
                    ? "Transferencia bancaria"
                    : paymentBooking.customer.paymentMethod === "tarjeta o mercado pago"
                      ? "Tarjeta o Mercado Pago"
                      : paymentBooking.customer.paymentMethod === "efectivo"
                        ? "Efectivo"
                        : "No especificado"}
                </span>
              </p>
              <p>
                Total a pagar:{" "}
                <span className="font-semibold text-gold">
                  ${paymentBooking.totalPrice.toLocaleString("es-AR")}
                </span>
              </p>
              {paymentBooking.customer.paymentMethod === "efectivo" && (
                <p className="text-muted-foreground">
                  El pago en efectivo se realiza en la sucursal; el pago en línea no está disponible
                  para este método de pago.
                </p>
              )}
            </div>
          ) : null}
          <DialogFooter className="flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-4 sm:space-x-0">
            {showTransferDetails ? (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={busyBookingId !== null}
                onClick={() => setShowTransferDetails(false)}
              >
                Volver
              </Button>
            ) : paymentBooking ? (
              paymentBooking.paymentCancellationStatus ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setPaymentBooking(null)}
                >
                  Cerrar
                </Button>
              ) : canRequestPaymentRefund(paymentBooking) ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={busyBookingId !== null}
                    onClick={() => setPaymentBooking(null)}
                  >
                    Volver
                  </Button>
                  {isValidRefundDestination(refundDestinationType, refundDestination) &&
                    ((paymentBooking.status === "cancelled" &&
                      (paymentBooking.cancelledBy === "professional" ||
                        isEligibleCancelledClientPayment(paymentBooking))) ||
                      Date.parse(`${paymentBooking.date}T${paymentBooking.time}:00-03:00`) -
                        currentTime >=
                        (cancellationPolicyFor(paymentBooking)?.cancellationWindowMinutes ?? 30) *
                          60 *
                          1000) && (
                      <Button
                        type="button"
                        className="w-full bg-gold text-primary-foreground hover:bg-gold-soft sm:w-auto"
                        disabled={busyBookingId !== null}
                        onClick={() => void cancelPayment(paymentBooking)}
                      >
                        {busyBookingId === paymentBooking.id
                          ? "Cancelando y avisando…"
                          : paymentBooking.status === "cancelled" &&
                              paymentBooking.cancelledBy === "professional"
                            ? "Solicitar devolución completa"
                            : isEligibleCancelledClientPayment(paymentBooking)
                              ? "Solicitar devolución"
                              : "Cancelar turno y solicitar devolución"}
                      </Button>
                    )}
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={
                      busyBookingId !== null || paymentBooking.paymentReportedAt !== undefined
                    }
                    onClick={() => {
                      setNewPaymentMethod(paymentBooking.customer.paymentMethod ?? "efectivo");
                      setChangingPaymentBooking(paymentBooking);
                    }}
                  >
                    Cambiar método de pago
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 sm:w-auto"
                    disabled={busyBookingId !== null || !!paymentBooking.paymentReportedAt}
                    onClick={() => void reportPayment(paymentBooking)}
                  >
                    {busyBookingId === paymentBooking.id
                      ? "Procesando..."
                      : "Indicar pago realizado"}
                  </Button>
                  {paymentBooking.customer.paymentMethod !== "efectivo" && (
                    <Button
                      type="button"
                      disabled={busyBookingId !== null}
                      className="w-full bg-gold text-primary-foreground hover:bg-gold-soft sm:w-auto"
                      onClick={() => void payBooking(paymentBooking)}
                    >
                      {payingBookingId === paymentBooking.id ? "Preparando pago…" : "Pagar"}
                    </Button>
                  )}
                </>
              )
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={changingPaymentBooking !== null}
        onOpenChange={(open) => {
          if (!open && !busyBookingId) setChangingPaymentBooking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar método de pago</DialogTitle>
            <DialogDescription>
              Podés cambiarlo mientras el profesional no haya confirmado el pago.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm text-muted-foreground">
            <span>Nuevo método</span>
            <select
              value={newPaymentMethod}
              onChange={(event) =>
                setNewPaymentMethod(
                  event.target.value as NonNullable<Booking["customer"]["paymentMethod"]>,
                )
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia bancaria</option>
              <option value="tarjeta o mercado pago">Tarjeta o Mercado Pago</option>
            </select>
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busyBookingId !== null}
              onClick={() => setChangingPaymentBooking(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                !changingPaymentBooking ||
                changingPaymentBooking.paymentStatus === "approved" ||
                busyBookingId !== null
              }
              className="bg-gold text-primary-foreground hover:bg-gold-soft"
              onClick={() => void savePaymentMethod()}
            >
              {busyBookingId === changingPaymentBooking?.id ? "Guardando…" : "Guardar método"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
