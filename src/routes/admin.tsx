import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, isToday, isThisWeek, isThisMonth, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { BarChart3, Calendar, Check, Clock, CreditCard, Scissors, Trash2, TrendingUp, Users, X } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, TooltipProps } from "recharts";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { bookingStore, getBarber, type Booking } from "@/lib/booking-store";
import { professionalStore, getProfessional, getProfessionalService, getAvailableSlotsForDate, type Professional } from "@/lib/professional-store";
import { toast } from "sonner";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import { bootstrapCloudData, createSubscriptionCheckout, getAvailableStores, getCurrentStoreCode, redeemSubscriptionPromo, verifySubscriptionPayment, type Store } from "@/lib/cloud-sync";
import { LoadingScreen } from "@/components/loading-screen";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Panel" }] }),
  component: AdminPage,
});

const SUBSCRIPTION_PLANS = [
  { id: "15d", label: "15 días", amount: 5999 },
  { id: "1m", label: "1 mes", amount: 9999 },
  { id: "2m", label: "2 meses", amount: 14999 },
  { id: "3m", label: "3 meses", amount: 19999 },
  { id: "4m", label: "4 meses", amount: 25999 },
  { id: "6m", label: "6 meses", amount: 36999 },
] as const;

function AdminPage() {
  const { isAuthenticated, isLoading, role, getIdToken, user } = useAppAuth();
  const location = useLocation();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [storeInfo, setStoreInfo] = useState<Store | undefined>(() => getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
  const [selectedPlanId, setSelectedPlanId] = useState<string>("15d");
  const [promoCode, setPromoCode] = useState("");
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState("");
  const [pendingPurchaseId, setPendingPurchaseId] = useState("");
  const [bookingEditDialogOpen, setBookingEditDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [editMode, setEditMode] = useState<"attendance" | "confirmation" | "turno" | null>(null);
  const [editedDate, setEditedDate] = useState("");
  const [editedTime, setEditedTime] = useState("");
  const [editedProfessionalId, setEditedProfessionalId] = useState("");
  const [editedServiceId, setEditedServiceId] = useState("");

  useEffect(() => {
    const reload = () => setBookings(bookingStore.all());
    reload();
    window.addEventListener("bookings:changed", reload);
    return () => window.removeEventListener("bookings:changed", reload);
  }, []);

  useEffect(() => {
    const update = () => setStoreInfo(getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
    update();
    window.addEventListener("mi-turno-ya:cloud-ready", update);
    window.addEventListener("mi-turno-ya:store-changed", update);
    return () => {
      window.removeEventListener("mi-turno-ya:cloud-ready", update);
      window.removeEventListener("mi-turno-ya:store-changed", update);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.searchStr);
    const status = params.get("subscription_payment");
    const purchaseId = params.get("purchase_id");
    if (!status || !purchaseId) return;
    let cancelled = false;
    setPendingPurchaseId(purchaseId);
    setSubscriptionBusy(true);
    if (status !== "success") {
      setPaymentNotice(status === "pending" ? "El pago está pendiente. La sucursal se activará cuando Mercado Pago lo apruebe." : "El pago no se completó. La sucursal sigue sin activar.");
      setSubscriptionBusy(false);
      return;
    }
    void verifySubscriptionPayment(purchaseId)
      .then(async (result) => {
        if (cancelled) return;
        if (!result.approved) {
          setPaymentNotice("Mercado Pago todavía no confirmó el pago. Podés comprobarlo nuevamente en unos instantes.");
          return;
        }
        await bootstrapCloudData(user?.email ?? "", getIdToken);
        if (cancelled) return;
        setPendingPurchaseId("");
        setStoreInfo(getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
        setPaymentNotice("Pago aprobado. Tu plan está activo.");
        toast.success("Pago aprobado; el sistema de turnos quedó activo.");
      })
      .catch((error: unknown) => {
        if (!cancelled) setPaymentNotice(error instanceof Error ? error.message : "No se pudo verificar el pago.");
      })
      .finally(() => { if (!cancelled) setSubscriptionBusy(false); });
    return () => { cancelled = true; };
  }, [getIdToken, location.searchStr, user?.email]);

  useEffect(() => {
    if (!selectedBooking) return;
    setEditedDate(selectedBooking.date);
    setEditedTime(selectedBooking.time);
    setEditedProfessionalId(selectedBooking.barberId);
    setEditedServiceId(selectedBooking.serviceIds[0] ?? "");
  }, [selectedBooking]);

  const stats = useMemo(() => computeStats(bookings), [bookings]);
  const selectedPlan = SUBSCRIPTION_PLANS.find((plan) => plan.id === selectedPlanId) ?? SUBSCRIPTION_PLANS[0];
  const subscriptionIsActive = Boolean(storeInfo?.subscriptionExpiresAt && Date.parse(storeInfo.subscriptionExpiresAt) > currentTime);
  const subscriptionDaysRemaining = storeInfo?.subscriptionExpiresAt
    ? Math.ceil((Date.parse(storeInfo.subscriptionExpiresAt) - currentTime) / 86_400_000)
    : null;
  const professionals = professionalStore.all();
  const editedProfessional = professionals.find((p) => p.id === editedProfessionalId) ?? professionals[0];
  const availableSlotsForDate = useMemo(() => {
    if (!editedProfessional || !editedDate) return [];
    return getAvailableSlotsForDate(editedProfessional, new Date(editedDate));
  }, [editedProfessional, editedDate]);

  if (isLoading) return <LoadingScreen message="Preparando tu agenda" />;
  if (!isAuthenticated || role !== "admin") return <><SiteHeader /><AuthRequired role="admin" title="Administración" /></>;

  function openBookingDialog(booking: Booking, mode: "attendance" | "confirmation" | "turno") {
    setSelectedBooking(booking);
    setEditMode(mode);
    setBookingEditDialogOpen(true);
  }

  function closeBookingDialog() {
    setBookingEditDialogOpen(false);
    setSelectedBooking(null);
    setEditMode(null);
  }

  async function saveBookingEdit() {
    if (!selectedBooking || !editMode) return;
    if (editMode === "turno") {
      const professional = professionalStore.get(editedProfessionalId);
      if (!professional) {
        toast.error("No se encontró profesional válido");
        return;
      }
      const service = professional.services.find((svc) => svc.id === editedServiceId) ?? professional.services[0];
      if (!service) {
        toast.error("No hay servicios disponibles para este profesional");
        return;
      }
      try {
        await bookingStore.update(selectedBooking.id, {
          barberId: professional.id,
          serviceIds: [service.id],
          duration: service.duration,
          totalPrice: service.price,
          date: editedDate,
          time: editedTime,
        });
        toast.success("Turno modificado y guardado en la base.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio en la base.");
        return;
      }
    }
    closeBookingDialog();
  }

  async function confirmAttendance(choice: "completed" | "no-show") {
    if (!selectedBooking) return;
    try {
      await bookingStore.update(selectedBooking.id, { status: choice });
      toast.success(choice === "completed" ? "Asistencia registrada" : "Turno indicado como no asistió");
      closeBookingDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la asistencia en la base.");
    }
  }

  async function setAppointmentConfirmation(choice: "confirmed" | "pending") {
    if (!selectedBooking) return;
    try {
      await bookingStore.update(selectedBooking.id, { appointmentConfirmation: choice });
      toast.success(choice === "confirmed" ? "Turno confirmado por el cliente" : "El cliente todavía no confirmó el turno");
      closeBookingDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la confirmación.");
    }
  }

  async function deleteBooking(id: string) {
    try {
      await bookingStore.remove(id);
      toast("Turno eliminado de la base de datos.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el turno.");
    }
  }

  async function startSubscriptionCheckout() {
    setSubscriptionBusy(true);
    setPaymentNotice("");
    try {
      const checkout = await createSubscriptionCheckout(selectedPlanId);
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      setPaymentNotice(error instanceof Error ? error.message : "No se pudo iniciar el pago del plan.");
      setSubscriptionBusy(false);
    }
  }

  async function applyPromoCode() {
    setSubscriptionBusy(true);
    setPaymentNotice("");
    try {
      const result = await redeemSubscriptionPromo(promoCode, selectedPlanId);
      await bootstrapCloudData(user?.email ?? "", getIdToken);
      setStoreInfo(getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
      setPromoCode("");
      setPaymentNotice(`Cupón aplicado: ${result.planLabel} gratis, hasta ${format(new Date(result.expiresAt), "d 'de' MMMM yyyy", { locale: es })}.`);
      toast.success("Cupón aplicado y plan activado.");
    } catch (error) {
      setPaymentNotice(error instanceof Error ? error.message : "No se pudo aplicar el cupón.");
    } finally {
      setSubscriptionBusy(false);
    }
  }

  async function retrySubscriptionVerification() {
    if (!pendingPurchaseId) return;
    setSubscriptionBusy(true);
    try {
      const result = await verifySubscriptionPayment(pendingPurchaseId);
      if (!result.approved) {
        setPaymentNotice("Mercado Pago todavía no confirmó el pago. Esperá un momento e intentá verificar otra vez.");
        return;
      }
      await bootstrapCloudData(user?.email ?? "", getIdToken);
      setStoreInfo(getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
      setPendingPurchaseId("");
      setPaymentNotice("Pago aprobado. Tu plan está activo.");
      toast.success("Pago aprobado; el sistema de turnos quedó activo.");
    } catch (error) {
      setPaymentNotice(error instanceof Error ? error.message : "No se pudo verificar el pago.");
    } finally {
      setSubscriptionBusy(false);
    }
  }

  async function confirmPayment(id: string) {
    try {
      await bookingStore.update(id, { status: "confirmed" });
      toast.success("Pago verificado y turno confirmado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el pago verificado.");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-gold">Panel administrador</p>
            <h1 className="font-display text-4xl font-semibold">Agenda & Estadísticas</h1>
            <p className="mt-2 text-sm text-muted-foreground">Sucursal: <span className="font-semibold text-gold">{getCurrentStoreCode()}</span></p>
          </div>
        </div>

        <section className="mb-8 rounded-3xl border border-gold/30 bg-card p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-gold">Suscripción del sistema de turnos</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">{subscriptionIsActive ? "Plan activo" : "Plan inactivo"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {subscriptionIsActive && storeInfo?.subscriptionExpiresAt
                  ? `Activo hasta ${format(new Date(storeInfo.subscriptionExpiresAt), "d 'de' MMMM yyyy", { locale: es })}.` 
                  : "La sucursal no aparece en las búsquedas y no acepta reservas hasta activar un plan."}
              </p>
              {storeInfo?.subscriptionPlanType === "trial" && subscriptionIsActive && (
                <p className="mt-2 text-sm font-medium text-gold">Estás usando tu prueba gratuita de 4 días. Elegí un paquete antes de que venza para continuar.</p>
              )}
              {storeInfo?.subscriptionExpiresAt && subscriptionDaysRemaining !== null && subscriptionDaysRemaining > 0 && subscriptionDaysRemaining <= 3 && (
                <p role="alert" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                  Tu plan vence {subscriptionDaysRemaining === 1 ? "dentro de 1 día" : `dentro de ${subscriptionDaysRemaining} días`}. Recordá elegir y pagar un plan manualmente para mantener activa la sucursal.
                </p>
              )}
              {storeInfo?.subscriptionExpiresAt && subscriptionDaysRemaining !== null && subscriptionDaysRemaining <= 0 && (
                <p role="alert" className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  Tu plan venció el {format(new Date(storeInfo.subscriptionExpiresAt), "d 'de' MMMM yyyy", { locale: es })}. La sucursal dejó de aparecer en las búsquedas y no puede recibir reservas hasta que pagues un nuevo plan.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">El plan es prepago y no se renueva ni cobra automáticamente. El sistema te avisa aquí cuando falten 3 días para el vencimiento.</p>
            </div>
            <CreditCard className="h-7 w-7 text-gold" />
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SUBSCRIPTION_PLANS.map((plan) => (
              <button key={plan.id} type="button" onClick={() => setSelectedPlanId(plan.id)} className={`rounded-xl border p-3 text-left transition ${selectedPlanId === plan.id ? "border-gold bg-gold/10" : "border-border bg-background hover:border-gold/50"}`}>
                <span className="block font-semibold">{plan.label}</span>
                <span className="text-sm text-muted-foreground">${plan.amount.toLocaleString("es-AR")}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button disabled={subscriptionBusy} onClick={() => void startSubscriptionCheckout()} className="bg-gold text-primary-foreground hover:bg-gold-soft">
              {subscriptionBusy ? "Procesando…" : `Pagar $${selectedPlan.amount.toLocaleString("es-AR")} con Mercado Pago`}
            </Button>
            <input className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" value={promoCode} onChange={(event) => setPromoCode(event.target.value.toUpperCase())} placeholder="Código promocional" aria-label="Código promocional" />
            <Button type="button" variant="outline" disabled={subscriptionBusy || !promoCode.trim()} onClick={() => void applyPromoCode()}>
              Aplicar cupón (100% OFF)
            </Button>
          </div>
          {paymentNotice && (
            <div role="status" className="mt-3 rounded-lg border border-border bg-background p-3 text-sm">
              <p>{paymentNotice}</p>
              {pendingPurchaseId && <Button type="button" variant="outline" size="sm" className="mt-2" disabled={subscriptionBusy} onClick={() => void retrySubscriptionVerification()}>Verificar pago</Button>}
            </div>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={TrendingUp} label="Profesional con más atención" value={`${stats.topBarber.name} · ${stats.topBarber.count}`} />
          <Stat icon={TrendingUp} label="Profesional con menos atención" value={`${stats.lowBarber.name} · ${stats.lowBarber.count}`} />
          <Stat icon={Users} label="Último cliente" value={stats.lastClient} />
          <Stat icon={Calendar} label="Último profesional" value={stats.lastBarber} />
        </div>

        <Tabs defaultValue="agenda" className="mt-10">
          <TabsList>
            <TabsTrigger value="agenda">Agenda</TabsTrigger>
            <TabsTrigger value="stats">Estadísticas</TabsTrigger>
          </TabsList>

          <TabsContent value="agenda" className="mt-6">
            <AgendaList bookings={bookings} onOpenBookingDialog={openBookingDialog} onDeleteBooking={deleteBooking} onConfirmPayment={confirmPayment} />
          </TabsContent>

          <TabsContent value="stats" className="mt-6 grid gap-6 md:grid-cols-2">
            <ChartCard title="Servicios más solicitados" data={stats.servicesChart} />
            <ChartCard title="Turnos por profesionales" data={stats.barbersChart} />
          </TabsContent>
        </Tabs>

        <Dialog open={bookingEditDialogOpen} onOpenChange={setBookingEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editMode === "attendance" && "Asistencia"}
                {editMode === "confirmation" && "Confirmación de turno"}
                {editMode === "turno" && "Modificar turno"}
              </DialogTitle>
              <DialogDescription>
                {editMode === "attendance" && "Selecciona si el cliente asistió o no al turno."}
                {editMode === "confirmation" && "¿El cliente confirmó el turno?"}
                {editMode === "turno" && "Modifica profesional, servicio y horario en un solo paso."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {editMode === "attendance" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button className="bg-emerald-500 text-white" onClick={() => confirmAttendance("completed")}>Sí asistió</Button>
                  <Button className="bg-red-500 text-white" onClick={() => confirmAttendance("no-show")}>No asistió</Button>
                </div>
              )}

              {editMode === "confirmation" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button className="bg-emerald-500 text-white" onClick={() => setAppointmentConfirmation("confirmed")}>Confirmó turno</Button>
                  <Button className="bg-amber-500 text-white hover:bg-amber-600" onClick={() => setAppointmentConfirmation("pending")}>No confirmó todavía</Button>
                </div>
              )}

              {editMode === "turno" && (
                <div className="grid gap-4">
                  <label className="text-sm text-muted-foreground block">
                    Profesional
                    <select
                      className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      value={editedProfessionalId}
                      onChange={(e) => {
                        setEditedProfessionalId(e.target.value);
                        const newProfessional = professionals.find((professional) => professional.id === e.target.value);
                        setEditedServiceId(newProfessional?.services[0]?.id ?? "");
                      }}
                    >
                      {professionals.map((professional) => (
                        <option key={professional.id} value={professional.id}>
                          {professional.name} — {professional.specialty}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm text-muted-foreground block">
                    Servicio
                    <select
                      className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      value={editedServiceId}
                      onChange={(e) => setEditedServiceId(e.target.value)}
                    >
                      {(editedProfessional?.services ?? []).map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm text-muted-foreground">
                    Fecha
                    <input
                      type="date"
                      className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      value={editedDate}
                      onChange={(e) => setEditedDate(e.target.value)}
                    />
                  </label>

                  <label className="text-sm text-muted-foreground">
                    Hora
                    <select
                      className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      value={editedTime}
                      onChange={(e) => setEditedTime(e.target.value)}
                    >
                      <option value="">Seleccionar hora</option>
                      {availableSlotsForDate.map((slot) => (
                        <option key={slot} value={slot}>{slot}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>

            {editMode === "turno" ? (
              <DialogFooter>
                <Button className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={saveBookingEdit}>
                  Guardar cambios
                </Button>
                <Button variant="outline" onClick={closeBookingDialog}>
                  Cancelar
                </Button>
              </DialogFooter>
            ) : null}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gold/15 text-gold">
        <Icon className="h-5 w-5" />
      </div>
      <div className="font-display text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function AgendaList({
  bookings,
  onOpenBookingDialog,
  onDeleteBooking,
  onConfirmPayment,
}: {
  bookings: Booking[];
  onOpenBookingDialog: (booking: Booking, mode: "attendance" | "confirmation" | "turno") => void;
  onDeleteBooking: (id: string) => void;
  onConfirmPayment: (id: string) => void;
}) {
  const upcoming = bookings
    .filter((b) => b.status !== "cancelled")
    .sort((a, b) => {
      if (!!a.isTest === !!b.isTest) {
        return (a.date + a.time).localeCompare(b.date + b.time);
      }
      return a.isTest ? 1 : -1;
    });
  if (!upcoming.length) {
    return <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">No hay turnos confirmados todavía.</p>;
  }
  return (
    <div className="space-y-2">
      {upcoming.map((b) => {
        const barber = getBarber(b.barberId);
        const services = b.serviceIds.map((id) => getProfessionalService(b.barberId, id)?.name).filter(Boolean).join(", ");
        const date = parseISO(`${b.date}T${b.time}`);
        return (
          <div key={b.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
            <div className="flex w-20 shrink-0 flex-col items-center rounded-lg bg-gold/10 px-2 py-2 text-gold">
              <span className="text-[10px] uppercase tracking-widest">{format(date, "EEE", { locale: es })}</span>
              <span className="font-display text-2xl font-semibold">{format(date, "d")}</span>
              <span className="text-[10px]">{b.time}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{b.customer.fullName}</div>
              <div className="truncate text-sm text-muted-foreground">{services} · {b.duration} min</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="border-gold/30 text-gold">{barber?.name}</Badge>
                {b.isTest && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Turno de prueba</Badge>}
                {b.status === "pending-payment" && <Badge variant="outline" className="border-amber-300 text-amber-300">Pago pendiente · {b.customer.paymentMethod}</Badge>}
                {b.status === "completed" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Asistió</Badge>}
                {b.status === "no-show" && <Badge variant="outline" className="border-red-300 text-red-400">No asistió</Badge>}
                {b.status !== "pending-payment" && b.status !== "cancelled" && (
                  <Badge variant="outline" className={b.appointmentConfirmation === "confirmed" ? "border-emerald-300 text-emerald-400" : "border-amber-300 text-amber-300"}>
                    {b.appointmentConfirmation === "confirmed" ? "Turno confirmado" : "No confirmó todavía"}
                  </Badge>
                )}
                <span>{b.customer.phone}</span>
              </div>
            </div>
            <div className="font-display text-lg font-semibold text-gold">${b.totalPrice.toLocaleString("es-AR")}</div>
            <div className="flex flex-wrap gap-2">
              {b.status === "pending-payment" && (
                <Button size="sm" variant="outline" onClick={() => onConfirmPayment(b.id)}>Confirmar pago</Button>
              )}
              {b.status === "confirmed" && (
                <Button size="sm" variant="outline" onClick={() => onOpenBookingDialog(b, "attendance")}>Indicar asistencia</Button>
              )}
              {b.status !== "pending-payment" && b.status !== "cancelled" && (
                <Button size="sm" variant="outline" onClick={() => onOpenBookingDialog(b, "confirmation")}>Confirmar turno</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onOpenBookingDialog(b, "turno")}>Modificar turno</Button>
              <Button size="sm" variant="destructive" disabled={b.isTest} onClick={() => onDeleteBooking(b.id)}>
                Borrar turno
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="rounded-2xl border border-gold/30 bg-slate-950/95 p-3 text-white shadow-xl">
      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name as string} className="flex items-center justify-between gap-4 text-sm leading-none">
          <span className="text-white leading-none">{entry.name}</span>
          <span className="font-semibold text-gold leading-none">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function ChartCard({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  const colors = ["#F59E0B", "#60A5FA", "#34D399", "#A855F7", "#F97316", "#22C55E"];

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="mb-4 font-display text-lg font-semibold">{title}</h3>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Sin datos aún.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="45%"
                outerRadius={90}
                innerRadius={52}
                paddingAngle={4}
                cornerRadius={8}
                stroke="transparent"
              >
                {data.map((entry, index) => (
                  <Cell key={entry.name} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} cursor={false} />
            </PieChart>
          </ResponsiveContainer>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {data.map((entry, index) => (
              <div key={entry.name} className="flex items-center justify-between rounded-2xl border border-border/80 bg-muted p-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                  <div>
                    <div className="text-sm font-medium text-foreground">{entry.name}</div>
                    <div className="text-xs text-muted-foreground">{title.includes("Servicios") ? "Servicio" : "Profesional"}</div>
                  </div>
                </div>
                <div className="text-sm font-semibold text-foreground">{entry.value}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function computeStats(bookings: Booking[]) {
  const active = bookings.filter((b) => b.status !== "cancelled");
  const today = active.filter((b) => isToday(parseISO(b.date))).length;
  const week = active.filter((b) => isThisWeek(parseISO(b.date), { weekStartsOn: 1 })).length;
  const monthBookings = active.filter((b) => isThisMonth(parseISO(b.date)));
  const monthRevenue = monthBookings.reduce((a, b) => a + b.totalPrice, 0);
  const uniqueClients = new Set(active.map((b) => b.customer.email.toLowerCase())).size;

  const allProfessionals = professionalStore.all();
  const serviceLookup = new Map<string, string>();
  allProfessionals.forEach((prof) => prof.services.forEach((svc) => serviceLookup.set(svc.id, svc.name)));

  const svcCount: Record<string, number> = {};
  active.forEach((b) => b.serviceIds.forEach((id) => { svcCount[id] = (svcCount[id] ?? 0) + 1; }));
  const servicesChart = Object.entries(svcCount)
    .map(([id, v]) => ({
      name: serviceLookup.get(id)?.split(" ")[0] ?? getProfessionalService("", id)?.name.split(" ")[0] ?? id,
      value: v,
    }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  const barbCount: Record<string, number> = {};
  allProfessionals.forEach((b) => { barbCount[b.id] = 0; });
  active.forEach((b) => { barbCount[b.barberId] = (barbCount[b.barberId] ?? 0) + 1; });
  const barbersChart = allProfessionals.map((b) => ({ name: b.name.split(" ")[0], value: barbCount[b.id] ?? 0 }));

  const sortedBarbers = allProfessionals.map((b) => ({ name: b.name, count: barbCount[b.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const topBarber = sortedBarbers[0] ?? { name: "-", count: 0 };
  const lowBarber = sortedBarbers[sortedBarbers.length - 1] ?? { name: "-", count: 0 };

  const lastBooking = [...active].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const lastClient = lastBooking?.customer.fullName || "-";
  const lastBarber = lastBooking ? getProfessional(lastBooking.barberId)?.name ?? "-" : "-";

  return { today, week, monthRevenue, uniqueClients, servicesChart, barbersChart, topBarber, lowBarber, lastClient, lastBarber };
}
