import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Clock3, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SiteHeader } from "@/components/site-header";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import type { Booking } from "@/lib/booking-store";
import { getAvailableSlotsForDate, getScheduleForDate, type Professional } from "@/lib/professional-store";
import { BOOKING_HIGHLIGHT_KEY, cancelClientPayment, createClientBookingPaymentPreference, deleteClientBooking, getClientBookings, reportClientPayment, updateClientBooking, updateClientPaymentMethod, type Store } from "@/lib/cloud-sync";
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
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [editedDate, setEditedDate] = useState("");
  const [editedTime, setEditedTime] = useState("");
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);
  const [showTransferDetails, setShowTransferDetails] = useState(false);
  const [changingPaymentBooking, setChangingPaymentBooking] = useState<Booking | null>(null);
  const [newPaymentMethod, setNewPaymentMethod] = useState<NonNullable<Booking["customer"]["paymentMethod"]>>("efectivo");
  const suppressPaymentClick = useRef(false);
  const [highlightedBookingId, setHighlightedBookingId] = useState("");
  const highlightTimeout = useRef<number | null>(null);

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
      setStores(result.stores);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar tus turnos.");
    } finally {
      setLoadingBookings(false);
    }
  }, []);

  async function openEditDialog(booking: Booking) {
    await reload();
    setEditingBooking(booking);
    setEditedDate(booking.date);
    setEditedTime(booking.time);
  }

  useEffect(() => {
    if (!isAuthenticated || role !== "client") return;
    void reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [isAuthenticated, reload, role]);

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
    try {
      const { initPoint } = await createClientBookingPaymentPreference(booking.id);
      paymentTab.location.href = initPoint;
    } catch (error) {
      paymentTab.close();
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar el pago.");
    } finally {
      setBusyBookingId(null);
    }
  }

  async function cancelPayment(booking: Booking) {
    if (busyBookingId || booking.paymentStatus === "approved") return;
    setBusyBookingId(booking.id);
    try {
      await cancelClientPayment(booking.id);
      setBookings((current) => current.filter((item) => item.id !== booking.id));
      setPaymentBooking(null);
      toast.success("Pago cancelado y turno liberado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar el pago.");
    } finally {
      setBusyBookingId(null);
    }
  }

  async function savePaymentMethod() {
    if (!changingPaymentBooking || busyBookingId) return;
    setBusyBookingId(changingPaymentBooking.id);
    try {
      const result = await updateClientPaymentMethod(changingPaymentBooking.id, newPaymentMethod);
      setBookings((current) => current.map((item) => item.id === changingPaymentBooking.id ? result.booking : item));
      setPaymentBooking(result.booking);
      suppressPaymentClick.current = true;
      window.setTimeout(() => { suppressPaymentClick.current = false; }, 600);
      setChangingPaymentBooking(null);
      setShowTransferDetails(false);
      toast.success("Método de pago actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el método de pago.");
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
      await reload();
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
              const statusLabel = booking.status === "completed" ? "Asistió" : booking.status === "no-show" ? "No asistió" : booking.status === "cancelled" ? "Cancelado" : "Reservado";
              const statusClass = booking.status === "completed" ? "border-emerald-300 text-emerald-400" : booking.status === "cancelled" || booking.status === "no-show" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-gold/40 text-gold";
              const paymentMethodLabel = booking.customer.paymentMethod === "efectivo"
                ? "Efectivo"
                : booking.customer.paymentMethod === "transferencia"
                  ? "Transferencia bancaria"
                  : booking.customer.paymentMethod === "tarjeta o mercado pago"
                    ? "Tarjeta o Mercado Pago"
                    : "No especificado";
              const isActiveBooking = booking.status === "confirmed" || booking.status === "pending-payment";
              const canDelete = isActiveBooking && [
                "efectivo",
                "transferencia",
                "tarjeta o mercado pago",
              ].includes(booking.customer.paymentMethod ?? "");
              return (
                <article key={booking.id} id={`booking-${booking.id}`} className={`flex flex-wrap items-center gap-4 rounded-xl border p-4 transition-colors duration-300 ${highlightedBookingId === booking.id ? "border-gold bg-gold/20 ring-2 ring-gold/70" : "border-gold/30 bg-card"}`}>
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
                      {(booking.status === "pending-payment" || booking.paymentStatus === "pending") && <Badge variant="outline" className="border-amber-300 text-amber-300">Pago pendiente</Badge>}
                      {booking.paymentReportedAt && booking.paymentStatus !== "approved" && <Badge variant="outline" className="border-amber-300 text-amber-300">Avisaste que pagaste · Podés modificar el turno hasta que lo verifique el profesional</Badge>}
                      {booking.paymentStatus === "approved" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Pago confirmado · Solo el profesional puede modificarlo</Badge>}
                    </div>
                  </div>
                  <div className="font-display text-lg font-semibold text-gold">${booking.totalPrice.toLocaleString("es-AR")}</div>
                  {isActiveBooking && <div className="flex flex-wrap gap-2">
                    {booking.paymentStatus !== "approved" && <Button size="sm" disabled={busyBookingId !== null} className="bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60" onClick={() => { setPaymentBooking(booking); setShowTransferDetails(false); }}>Indicar pago</Button>}
                    {booking.paymentStatus !== "approved" && <Button size="sm" variant="outline" disabled={busyBookingId !== null} onClick={() => void openEditDialog(booking)}>Modificar turno</Button>}
                    {canDelete && <Button size="sm" variant="destructive" disabled={busyBookingId !== null || booking.paymentStatus === "approved"} title={booking.paymentStatus === "approved" ? "No se puede borrar un turno pagado." : undefined} className={busyBookingId === booking.id || booking.paymentStatus === "approved" ? "opacity-60" : undefined} onClick={() => void deleteBooking(booking)}>{busyBookingId === booking.id ? "Borrando..." : "Borrar turno"}</Button>}
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
      <Dialog open={paymentBooking !== null} onOpenChange={(open) => { if (!open && !busyBookingId) { setPaymentBooking(null); setShowTransferDetails(false); } }}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{showTransferDetails ? "Datos para la transferencia" : "Confirmar pago"}</DialogTitle>
            <DialogDescription>
              {showTransferDetails
                ? `Realizá la transferencia bancaria.`
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
                  <p className="border-t border-border pt-3 font-semibold text-gold">Importe: ${paymentBooking.totalPrice.toLocaleString("es-AR")}</p>
                </>;
              })()}
            </div>
          ) : paymentBooking ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
              <p>Método de pago: <span className="font-medium text-gold">{paymentBooking.customer.paymentMethod ?? "No especificado"}</span></p>
              <p>Importe: <span className="font-semibold text-gold">${paymentBooking.totalPrice.toLocaleString("es-AR")}</span></p>
              {paymentBooking.customer.paymentMethod === "efectivo" && <p className="text-muted-foreground">El pago en efectivo se realiza en la sucursal; el pago en línea no está disponible para este método.</p>}
              {paymentBooking.paymentStatus === "approved" && <p className="text-emerald-400">El profesional ya confirmó este pago.</p>}
            </div>
          ) : null}
          <DialogFooter className="mobile-scrollbar-hidden flex-row flex-nowrap gap-1 overflow-x-auto sm:space-x-0">
            {showTransferDetails ? (
              <Button type="button" variant="outline" disabled={busyBookingId !== null} onClick={() => setShowTransferDetails(false)}>Volver</Button>
            ) : paymentBooking ? (
              <>
                <Button type="button" variant="outline" disabled={busyBookingId !== null || paymentBooking.paymentStatus === "approved"} onClick={() => void cancelPayment(paymentBooking)}>Cancelar pago</Button>
                <Button type="button" variant="outline" disabled={busyBookingId !== null || paymentBooking.paymentStatus === "approved"} onClick={() => {
                  setNewPaymentMethod(paymentBooking.customer.paymentMethod ?? "efectivo");
                  setChangingPaymentBooking(paymentBooking);
                }}>Cambiar método de pago</Button>
                <Button type="button" variant="outline" disabled={busyBookingId !== null || paymentBooking.paymentStatus === "approved" || !!paymentBooking.paymentReportedAt} className="border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60" onClick={() => void reportPayment(paymentBooking)}>Indicar pago realizado</Button>
                <Button type="button" disabled={busyBookingId !== null || paymentBooking.paymentStatus === "approved" || paymentBooking.customer.paymentMethod === "efectivo"} className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void payBooking(paymentBooking)}>
                  {busyBookingId === paymentBooking.id ? "Preparando pago…" : "Pagar"}
                </Button>
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
