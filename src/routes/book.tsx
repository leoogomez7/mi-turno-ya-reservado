import { createFileRoute, Link, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Star, Clock, Calendar as CalIcon, Briefcase, User, Copy } from "lucide-react";
import { addDays, format, isBefore, isSameDay, parseISO, startOfToday } from "date-fns";
import { es } from "date-fns/locale";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { bookingStore, type Booking, type Customer } from "@/lib/booking-store";
import { type Professional, getScheduleForDate, generateSlotsFromSchedule, isProfessionalAvailableOnDate } from "@/lib/professional-store";
import { useAppAuth } from "@/lib/auth";
import { cancelPendingBooking, createPublicBooking, getAvailableStores, getClientProfile, getCloudRecords, getCurrentStoreCode, isCloudInitialized, loadReservationStore, refreshCloudData, selectStore, type Store } from "@/lib/cloud-sync";

export const Route = createFileRoute("/book")({
  beforeLoad: () => {
    throw redirect({ to: "/reserva" });
  },
});

const STEPS = ["Datos", "Profesional", "Servicios", "Horarios", "Confirmar"] as const;
const STEP_PATHS = {
  0: "/reserva",
  1: "/reserva/profesional",
  2: "/reserva/servicios",
  3: "/reserva/horario",
  4: "/reserva/confirmacion",
} as const;
function stepForPath(pathname: string) {
  return Object.entries(STEP_PATHS).find(([, path]) => path === pathname)?.[0] as keyof typeof STEP_PATHS | undefined;
}

const EMPTY_CUSTOMER: Customer = {
  fullName: "",
  phone: "",
  email: "",
  paymentMethod: undefined,
  notes: "",
};

function paymentMethodLabel(paymentMethod: Customer["paymentMethod"] | undefined) {
  switch (paymentMethod) {
    case "efectivo": return "Efectivo";
    case "transferencia": return "Transferencia Bancaria";
    case "tarjeta o mercado pago": return "Tarjeta o MercadoPago";
    default: return "Sin seleccionar";
  }
}

type ReservationResult = {
  kind: "confirmed" | "payment-success" | "payment-pending" | "payment-failure";
  date: string;
  time: string;
  paymentMethod?: Customer["paymentMethod"];
};

const PENDING_PAYMENT_SESSION_KEY = "mi-turno-ya:pending-payment-booking";
const SELECTED_STORE_SESSION_KEY = "mi-turno-ya:selected-booking-store";

export function BookPage() {
  const auth = useAppAuth();
  const { isAuthenticated, role, user } = auth;
  const location = useLocation();
  const initialStep = stepForPath(location.pathname) ?? 0;
  const [accountStoreCode] = useState(getCurrentStoreCode());
  const [step, setStep] = useState<number>(Number(initialStep));
  const [stepError, setStepError] = useState<string | null>(null);
  const [confirmingBooking, setConfirmingBooking] = useState(false);
  const [startingPayment, setStartingPayment] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState<"transfer" | null>(null);
  const [pendingTransferReturn, setPendingTransferReturn] = useState<Pick<ReservationResult, "date" | "time"> | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [reservationResult, setReservationResult] = useState<ReservationResult | null>(null);
  const [stores, setStores] = useState<Store[]>(getAvailableStores());
  const [reservationProfessionals, setReservationProfessionals] = useState<Professional[]>(getCloudRecords("professionals"));
  const [reservationBookings, setReservationBookings] = useState<Booking[]>(getCloudRecords("bookings"));
  const [selectedStoreCode, setSelectedStoreCode] = useState(getCurrentStoreCode());
  const [storeSelectionHydrated, setStoreSelectionHydrated] = useState(false);
  const [cloudDataReady, setCloudDataReady] = useState(isCloudInitialized);
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [storeSearch, setStoreSearch] = useState("");
  const [storeSearchSubmitted, setStoreSearchSubmitted] = useState(false);
  const [storeNotFound, setStoreNotFound] = useState(false);
  const [storeLoading, setStoreLoading] = useState(false);
  const navigate = useNavigate();
  const paymentReturn = new URLSearchParams(location.searchStr).get("payment");

  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER);
  const [barberId, setBarberId] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [date, setDate] = useState<Date | null>(null);
  const [time, setTime] = useState("");

  useEffect(() => {
    if (role !== "client") return;
    const accountName = [user?.givenName, user?.familyName].filter(Boolean).join(" ");
    setCustomer((current) => ({
      ...current,
      fullName: current.fullName || accountName,
      email: current.email || user?.email || "",
    }));

    let cancelled = false;
    void getClientProfile()
      .then((profile) => {
        if (cancelled) return;
        const accountEmail = user?.email?.trim().toLowerCase();
        const previousBookingPhone = bookingStore.all().find((booking) => booking.customer.email.trim().toLowerCase() === accountEmail)?.customer.phone;
        setCustomer((current) => current.phone ? current : { ...current, phone: profile.phone || previousBookingPhone || "" });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [role, user?.email, user?.familyName, user?.givenName]);

  useEffect(() => {
    const reloadStores = () => {
      setStores(getAvailableStores());
      setSelectedStoreCode((currentCode) => currentCode || getCurrentStoreCode());
      setCloudDataReady(true);
    };
    window.addEventListener("mi-turno-ya:cloud-ready", reloadStores);
    window.addEventListener("mi-turno-ya:store-changed", reloadStores);
    return () => {
      window.removeEventListener("mi-turno-ya:cloud-ready", reloadStores);
      window.removeEventListener("mi-turno-ya:store-changed", reloadStores);
    };
  }, []);

  useEffect(() => {
    const savedStoreCode = window.sessionStorage.getItem(SELECTED_STORE_SESSION_KEY);
    if (savedStoreCode) setSelectedStoreCode(savedStoreCode);
    setStoreSelectionHydrated(true);
  }, []);

  useEffect(() => {
    if (!storeSelectionHydrated) return;
    if (selectedStoreCode) {
      window.sessionStorage.setItem(SELECTED_STORE_SESSION_KEY, selectedStoreCode);
    } else {
      window.sessionStorage.removeItem(SELECTED_STORE_SESSION_KEY);
    }
  }, [selectedStoreCode, storeSelectionHydrated]);

  useEffect(() => {
    if (!cloudDataReady) return;
    const currentCode = selectedStoreCode || getCurrentStoreCode();
    const currentStore = stores.find((store) => store.code === currentCode);
    const hasActiveStore = Boolean(
      currentStore?.subscriptionExpiresAt
      && Date.parse(currentStore.subscriptionExpiresAt) > Date.now(),
    );

    if (hasActiveStore) {
      if (currentCode !== selectedStoreCode) setSelectedStoreCode(currentCode);
      setStorePickerOpen(false);
      setStepError(null);
      return;
    }

    if (selectedStoreCode) {
      setSelectedStoreCode("");
      setBarberId("");
      setServiceIds([]);
      setDate(null);
      setTime("");
    }
    const needsStore = !currentCode || !hasActiveStore;
    if (needsStore) {
      setStorePickerOpen(step === 0);
      if (step !== 0) {
        setStep(0);
        void navigate({ to: "/reserva", replace: true });
      }
      setStepError(step > 0 ? "Elegí una sucursal para poder continuar con la reserva." : null);
    }
  }, [cloudDataReady, navigate, selectedStoreCode, stores, step]);

  useEffect(() => {
    if (!cloudDataReady || !selectedStoreCode) return;
    let cancelled = false;
    setStoreLoading(true);
    void loadReservationStore(selectedStoreCode, isAuthenticated ? auth.getIdToken : undefined)
      .then(({ data, stores: loadedStores }) => {
        if (cancelled) return;
        setReservationProfessionals(data.professionals);
        setReservationBookings(data.bookings);
        setStores(loadedStores);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : "No se pudo cargar la sucursal elegida.");
      })
      .finally(() => {
        if (!cancelled) setStoreLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.getIdToken, cloudDataReady, isAuthenticated, selectedStoreCode]);

  useEffect(() => {
    if (!paymentReturn) return;
    let pendingPayment: { bookingId?: string; cancellationToken?: string; storeCode?: string; date?: string; time?: string; paymentMethod?: Customer["paymentMethod"]; whatsappMessage?: string } = {};
    try {
      const saved = window.localStorage.getItem(PENDING_PAYMENT_SESSION_KEY);
      if (saved) pendingPayment = JSON.parse(saved) as typeof pendingPayment;
    } catch {
      pendingPayment = {};
    }
    let cancelled = false;
    void (async () => {
      let resultKind: ReservationResult["kind"] = paymentReturn === "pending" ? "payment-pending" : "payment-failure";
      if (paymentReturn === "success" && pendingPayment.bookingId) {
        try {
          const response = await fetch("/api/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "verify-booking-payment", bookingId: pendingPayment.bookingId }),
            cache: "no-store",
          });
          const result = await response.json() as { approved?: boolean; error?: string };
          resultKind = response.ok && result.approved ? "payment-success" : "payment-pending";
        } catch {
          resultKind = "payment-pending";
        }
      } else if (paymentReturn === "failure" && pendingPayment.bookingId && pendingPayment.cancellationToken) {
        try {
          await cancelPendingBooking(pendingPayment.bookingId, pendingPayment.cancellationToken, pendingPayment.storeCode);
          await refreshCloudData();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "No se pudo liberar el horario del pago cancelado.");
        }
      }
      if (cancelled) return;
      if (resultKind !== "payment-pending") window.localStorage.removeItem(PENDING_PAYMENT_SESSION_KEY);
      setReservationResult({
        kind: resultKind,
        date: pendingPayment.date ?? "",
        time: pendingPayment.time ?? "",
        paymentMethod: pendingPayment.paymentMethod,
      });
      void navigate({ to: "/reserva", replace: true });
    })();
    return () => { cancelled = true; };
  }, [navigate, paymentReturn]);

  useEffect(() => {
    if (step !== 3 || !selectedStoreCode) return;
    let cancelled = false;
    const refresh = () => {
      void loadReservationStore(selectedStoreCode, isAuthenticated ? auth.getIdToken : undefined)
        .then(({ data, stores: loadedStores }) => {
          if (cancelled) return;
          setReservationProfessionals(data.professionals);
          setReservationBookings(data.bookings);
          setStores(loadedStores);
        })
        .catch(() => undefined);
    };
    refresh();
    const intervalId = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    };
  }, [auth.getIdToken, isAuthenticated, selectedStoreCode, step]);

  const activeStores = stores.filter((store) =>
    Boolean(store.subscriptionExpiresAt && Date.parse(store.subscriptionExpiresAt) > Date.now()),
  );
  const matchingStores = activeStores.filter((store) => `${store.name} ${store.code}`.toLowerCase().includes(storeSearch.trim().toLowerCase()));
  const selectedStore = activeStores.find((store) => store.code === selectedStoreCode);
  const storeSettings = selectedStore?.settings;

  useEffect(() => {
    if (customer.paymentMethod === "tarjeta o mercado pago" && !selectedStore?.mercadoPagoConfigured) {
      setCustomer((current) => ({ ...current, paymentMethod: undefined }));
    }
  }, [customer.paymentMethod, selectedStore?.mercadoPagoConfigured]);

  async function chooseStore(store: Store) {
    setStoreLoading(true);
    try {
      if (role !== "admin" && store.code !== getCurrentStoreCode()) {
        await selectStore(store.code, user?.email ?? "guest", auth.getIdToken);
      }
      setSelectedStoreCode(store.code);
      setStorePickerOpen(false);
      setStoreNotFound(false);
      setStoreSearchSubmitted(false);
      setStoreSearch("");
      setBarberId("");
      setServiceIds([]);
      setDate(null);
      setTime("");
      setStepError(null);
      toast.success(`Seleccionaste ${store.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar de sucursal.");
    } finally {
      setStoreLoading(false);
    }
  }

  async function saveBooking(input: Omit<Booking, "id" | "createdAt">) {
    if (role === "admin" && selectedStoreCode !== accountStoreCode) {
      return createPublicBooking(selectedStoreCode, input);
    }
    return bookingStore.add(input);
  }

  const selectedProfessional = reservationProfessionals.find((professional) => professional.id === barberId);
  const selectedServices = selectedProfessional?.services ?? [];
  const duration = selectedServices.reduce((total, service) => total + (serviceIds.includes(service.id) ? service.duration : 0), 0);
  const price = selectedServices.reduce((total, service) => total + (serviceIds.includes(service.id) ? service.price : 0), 0);

  function createBookingWhatsAppMessage(includePaymentProofNote: boolean) {
    const serviceNames = selectedServices
      .filter((service) => serviceIds.includes(service.id))
      .map((service) => service.name)
      .join(", ");
    const message = `Hola! Quiero confirmar un turno.
Sucursal: ${selectedStore?.name ?? ""}
Dirección: ${selectedStore?.settings.address || "No especificada"}
Cliente: ${customer.fullName}
Teléfono: ${customer.phone}
Email: ${customer.email}
Profesional: ${selectedProfessional?.name ?? ""}
Servicios: ${serviceNames}
Fecha: ${date ? format(date, "EEEE d 'de' MMMM yyyy", { locale: es }) : ""}
Horario: ${time}
Método de pago: ${paymentMethodLabel(customer.paymentMethod)}
Precio total: $${price}
Observaciones: ${customer.notes || "Ninguna"}`;

    return includePaymentProofNote
      ? `${message}\nVoy a enviar el comprobante para que confirme pago.`
      : message;
  }

  useEffect(() => {
    const pathStep = stepForPath(location.pathname);
    if (pathStep === undefined) return;
    setStep(Number(pathStep));
  }, [location.pathname]);

  function goToStep(nextStep: number) {
    const safeStep = Math.max(0, Math.min(STEPS.length - 1, nextStep));
    setStep(safeStep);
    setStepError(null);
    navigate({ to: STEP_PATHS[safeStep as keyof typeof STEP_PATHS] });
  }

  const canNext = useMemo(() => {
    if (step === 0) {
      return customer.fullName.trim().length > 0
        && customer.phone.trim().length >= 6
        && /.+@.+\..+/.test(customer.email)
        && !!customer.paymentMethod;
    }
    if (step === 1) return !!barberId;
    if (step === 2) return serviceIds.length > 0;
    if (step === 3) return !!date && !!time;
    return true;
  }, [step, customer, barberId, serviceIds, date, time]);

  async function confirm() {
    if (confirmingBooking) return;
    if (isAuthenticated && role === "client" && user?.email && customer.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      toast.error("Para ver este turno en tu cuenta, usá el mismo correo con el que iniciaste sesión.");
      return;
    }
    if (!date || !time) {
      toast.error("Seleccioná fecha y horario antes de confirmar.");
      return;
    }

    setConfirmingBooking(true);
    try {
    if (customer.paymentMethod === "transferencia") {
      try {
        await saveBooking({
        storeCode: selectedStoreCode,
        customer, barberId, serviceIds,
        date: format(date, "yyyy-MM-dd"),
        time, duration, totalPrice: price, status: "pending-payment",
        });
        setReservationResult({
          kind: "payment-pending",
          date: format(date, "yyyy-MM-dd"),
          time,
          paymentMethod: "transferencia",
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo guardar el turno.");
      }
      return;
    }

    if (customer.paymentMethod === "tarjeta o mercado pago") {
      setPaymentError(null);
      let pendingBooking: Booking | null = null;
      try {
        pendingBooking = await saveBooking({
          storeCode: selectedStoreCode,
          customer, barberId, serviceIds,
          date: format(date, "yyyy-MM-dd"),
          time, duration, totalPrice: price, status: "pending-payment",
        });
        window.localStorage.setItem(PENDING_PAYMENT_SESSION_KEY, JSON.stringify({
          bookingId: pendingBooking.id,
          cancellationToken: pendingBooking.cancellationToken,
          storeCode: selectedStoreCode,
          date: format(date, "yyyy-MM-dd"),
          time,
          paymentMethod: customer.paymentMethod,
          whatsappMessage: createBookingWhatsAppMessage(true),
        }));
        setReservationResult({
          kind: "payment-pending",
          date: format(date, "yyyy-MM-dd"),
          time,
          paymentMethod: customer.paymentMethod,
        });
      } catch (error) {
        setReservationResult(null);
        if (pendingBooking) {
          try {
            if (role === "admin" && selectedStoreCode !== accountStoreCode && pendingBooking.cancellationToken) {
              await cancelPendingBooking(pendingBooking.id, pendingBooking.cancellationToken, selectedStoreCode);
            } else {
              await bookingStore.update(pendingBooking.id, { status: "cancelled" });
            }
          } catch {
            // Conserva el turno pendiente si la limpieza no pudo sincronizarse.
          }
        }
        window.localStorage.removeItem(PENDING_PAYMENT_SESSION_KEY);
        setPaymentError(error instanceof Error ? error.message : "No se pudo preparar el pago.");
      }
      return;
    }

    try {
      await saveBooking({
        storeCode: selectedStoreCode,
        customer, barberId, serviceIds,
        date: format(date, "yyyy-MM-dd"),
        time, duration, totalPrice: price,
        status: "confirmed",
      });
      setReservationResult({ kind: "confirmed", date: format(date, "yyyy-MM-dd"), time });
      toast.success("¡Turno confirmado!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el turno.");
    }
    } finally {
      setConfirmingBooking(false);
    }
  }

  async function startMercadoPagoPayment() {
    if (startingPayment) return;
    setStartingPayment(true);
    try {
      const saved = window.localStorage.getItem(PENDING_PAYMENT_SESSION_KEY);
      const pendingPayment = saved ? JSON.parse(saved) as { bookingId?: string; cancellationToken?: string } : null;
      if (!pendingPayment?.bookingId) throw new Error("No encontramos el turno pendiente para iniciar el pago.");

      const response = await fetch("/api/mercadopago/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: pendingPayment.bookingId, cancellationToken: pendingPayment.cancellationToken }),
      });
      const result = await response.json() as { initPoint?: string; error?: string };
      if (!response.ok || !result.initPoint) throw new Error(result.error || "No se pudo preparar el pago.");
      window.location.assign(result.initPoint);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar el pago.");
      setStartingPayment(false);
    }
  }

  function sendPendingBookingWhatsApp() {
    if (!storeSettings?.whatsapp) {
      toast.error("La sucursal todavía no configuró su WhatsApp.");
      return;
    }
    let message = createBookingWhatsAppMessage(true);
    try {
      const saved = window.localStorage.getItem(PENDING_PAYMENT_SESSION_KEY);
      const pendingPayment = saved ? JSON.parse(saved) as { whatsappMessage?: string } : null;
      if (pendingPayment?.whatsappMessage) message = pendingPayment.whatsappMessage;
    } catch {
      // Uses the current form data if no saved message is available.
    }
    const whatsappUrl = `https://wa.me/${storeSettings.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  }

  function openTransferPaymentDetails(result: ReservationResult) {
    setPendingTransferReturn({ date: result.date, time: result.time });
    setReservationResult(null);
    setPaymentDialog("transfer");
  }

  function closeTransferPaymentDetails() {
    setPaymentDialog(null);
    if (pendingTransferReturn) {
      setReservationResult({
        kind: "payment-pending",
        ...pendingTransferReturn,
        paymentMethod: "transferencia",
      });
      setPendingTransferReturn(null);
    }
  }

  async function copyTransferValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Dato copiado.");
    } catch {
      toast.error("No se pudo copiar el dato.");
    }
  }

  function handleContinue() {
    if (!selectedStoreCode || !selectedStore) {
      const message = "Elegí una sucursal para poder continuar con la reserva.";
      setStepError(message);
      if (step === 0) {
        setStorePickerOpen(true);
      } else {
        setStep(0);
        void navigate({ to: "/reserva", replace: true });
      }
      toast.error(message);
      return;
    }

    if (!canNext) {
      let message = "Completá los datos antes de continuar.";

      if (step === 0) {
        if (!customer.fullName.trim()) {
          message = "Ingresá tu nombre completo.";
        } else if (customer.phone.trim().length < 6) {
          message = "El teléfono debe tener al menos 6 caracteres.";
        } else if (!/.+@.+\..+/.test(customer.email)) {
          message = "El correo electrónico no es válido.";
        } else if (!customer.paymentMethod) {
          message = "Elegí un método de pago.";
        }
      } else if (step === 1) {
        message = "Elegí un profesional para continuar.";
      } else if (step === 2) {
        message = "Seleccioná al menos un servicio para continuar.";
      } else if (step === 3) {
        message = "Elegí fecha y horario para continuar.";
      }

      setStepError(message);
      toast.error(message);
      return;
    }

    goToStep(step + 1);
  }

  function startNewBooking() {
    setReservationResult(null);
    setPaymentDialog(null);
    setPaymentError(null);
    window.localStorage.removeItem(PENDING_PAYMENT_SESSION_KEY);
    setCustomer(EMPTY_CUSTOMER);
    setBarberId("");
    setServiceIds([]);
    setDate(null);
    setTime("");
    goToStep(0);
  }

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        {step === 0 && <section
          className={cn(
            "mb-4 w-full rounded-3xl border border-gold/30 bg-card p-6",
            (!selectedStoreCode || !selectedStore) && "cursor-pointer transition-colors hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
          )}
          role={!selectedStoreCode || !selectedStore ? "button" : undefined}
          tabIndex={!selectedStoreCode || !selectedStore ? 0 : undefined}
          aria-label={!selectedStoreCode || !selectedStore ? "Buscar sucursal para reservar" : undefined}
          onClick={() => {
            if (!selectedStoreCode || !selectedStore) setStorePickerOpen(true);
          }}
          onKeyDown={(event) => {
            if ((!selectedStoreCode || !selectedStore) && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              setStorePickerOpen(true);
            }
          }}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-gold">{selectedStore ? "Sucursal seleccionada" : "Antes de reservar"}</p>
              <h2 className="mt-1 flex flex-wrap items-baseline gap-x-2 font-display text-2xl font-semibold">
                {selectedStore ? (
                  <>
                    <span>{selectedStore?.name ?? "Sucursal no disponible"}</span>
                    {selectedStore && <span className="font-sans text-sm font-medium text-muted-foreground">{selectedStore.code}</span>}
                  </>
                ) : "Seleccioná una sucursal · Tocá aquí para buscar"}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {selectedStore && <Button type="button" className="h-10 px-4 text-sm bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => setStorePickerOpen(true)}>Cambiar sucursal</Button>}
            </div>
          </div>
        </section>}
        {step === 0 && <Dialog open={storePickerOpen} onOpenChange={(open) => {
          setStorePickerOpen(open);
        }}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Elegí una sucursal</DialogTitle>
              <DialogDescription>Buscá por nombre o código.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="relative">
                <Input
                  autoFocus
                  value={storeSearch}
                  onChange={(event) => {
                    setStoreSearch(event.target.value);
                    setStoreNotFound(false);
                    setStoreSearchSubmitted(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setStoreSearchSubmitted(true);
                      setStoreNotFound(matchingStores.length === 0);
                      if (matchingStores.length === 1) void chooseStore(matchingStores[0]);
                    }
                  }}
                  placeholder="Nombre o código de sucursal"
                  aria-controls="store-search-results"
                  aria-expanded={Boolean(storeSearch.trim() && matchingStores.length)}
                />
                {storeSearch.trim() && matchingStores.length > 0 && (
                  <div id="store-search-results" role="listbox" aria-label="Sucursales encontradas" className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-gold/40 bg-background p-1 shadow-xl">
                    {matchingStores.map((store) => (
                      <button key={store.code} type="button" role="option" aria-selected={store.code === selectedStoreCode} disabled={storeLoading} onClick={() => void chooseStore(store)} className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left transition hover:bg-gold/10 focus-visible:bg-gold/10 focus-visible:outline-none disabled:opacity-60">
                        <span className="min-w-0 truncate font-medium">{store.name}</span>
                        <span className="shrink-0 text-sm text-muted-foreground">{store.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {storeLoading && (
                <p role="status" aria-live="polite" className="rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-sm text-gold">
                  Agregando sucursal…
                </p>
              )}
              <Button type="button" disabled={storeLoading || !storeSearch.trim()} className="w-full bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => {
                setStoreSearchSubmitted(true);
                setStoreNotFound(matchingStores.length === 0);
                if (matchingStores.length === 1) void chooseStore(matchingStores[0]);
              }}>
                {storeLoading ? "Agregando sucursal…" : "Buscar sucursal"}
              </Button>
              {storeSearchSubmitted && storeNotFound && <p role="status" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">No encontramos sucursales con ese nombre o código.</p>}
            </div>
          </DialogContent>
        </Dialog>}
        <Stepper step={step} />

        <div className="mt-4 w-full rounded-2xl border border-gold/30 bg-card p-5 sm:p-6">
          {step === 0 && <StepCustomer customer={customer} setCustomer={setCustomer} mercadoPagoAvailable={Boolean(selectedStore?.mercadoPagoConfigured)} />}
          {step === 1 && <StepBarber professionals={reservationProfessionals} value={barberId} onChange={setBarberId} />}
          {step === 2 && <StepServices professional={selectedProfessional} value={serviceIds} onChange={setServiceIds} />}
          {step === 3 && <StepDateTime professional={selectedProfessional} bookings={reservationBookings} date={date} setDate={setDate} time={time} setTime={setTime} barberId={barberId} duration={duration} />}
          {step === 4 && (date ? <StepConfirm professional={selectedProfessional} storeName={selectedStore?.name ?? selectedStoreCode} storeCode={selectedStoreCode} storeAddress={storeSettings?.address ?? ""} customer={customer} serviceIds={serviceIds} date={date} time={time} duration={duration} price={price} /> : <p className="py-8 text-center text-sm text-muted-foreground">Seleccioná fecha y horario para ver el resumen.</p>)}
        </div>

        {stepError && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {stepError}
          </div>
        )}
        {paymentError && (
          <div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {paymentError}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              goToStep(step - 1);
            }}
            disabled={step === 0}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Atrás
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={handleContinue} className="bg-gold text-primary-foreground hover:bg-gold-soft">
              Continuar <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" disabled={confirmingBooking} onClick={() => void confirm()} className="h-12 bg-gold px-8 text-base font-semibold text-primary-foreground shadow-gold hover:bg-gold-soft">
              {confirmingBooking ? "CONFIRMANDO..." : "CONFIRMAR TURNO"}
            </Button>
          )}
        </div>
      </main>
      <Dialog open={paymentDialog === "transfer"} onOpenChange={(open) => { if (!open) closeTransferPaymentDetails(); }}>
        <DialogContent>
          {paymentDialog === "transfer" && (
            <>
              <DialogHeader>
                <DialogTitle>Turno reservado · Transferencia pendiente</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
                <TransferDetail label="Titular" value={storeSettings?.transferHolder ?? ""} onCopy={copyTransferValue} />
                <TransferDetail label="Banco" value={storeSettings?.transferBank ?? ""} onCopy={copyTransferValue} />
                <TransferDetail label="CBU" value={storeSettings?.transferCbu ?? ""} onCopy={copyTransferValue} />
                <TransferDetail label="Alias" value={storeSettings?.transferAlias ?? ""} onCopy={copyTransferValue} />
              </div>
              <DialogFooter>
                <Button onClick={closeTransferPaymentDetails} className="bg-gold text-primary-foreground hover:bg-gold-soft">Volver a la reserva</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={reservationResult !== null} onOpenChange={(open) => {
        if (!open) {
          if (reservationResult?.kind === "payment-pending") setReservationResult(null);
          else startNewBooking();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reservationResult?.kind === "confirmed" ? "¡Turno confirmado!"
                : reservationResult?.kind === "payment-success" ? "¡Turno confirmado y pagado!"
                    : reservationResult?.kind === "payment-pending" ? "Turno reservado · Pago pendiente"
                      : "Turno no confirmado"}
            </DialogTitle>
            <DialogDescription>
              {reservationResult?.kind === "confirmed" ? "Tu reserva quedó confirmada."
                : reservationResult?.kind === "payment-success" ? "Mercado Pago confirmó el pago y el turno ya figura como pagado en la agenda de la sucursal."
                  : reservationResult?.kind === "payment-pending" ? reservationResult.paymentMethod === "transferencia"
                    ? "La sucursal confirmará el turno cuando verifique la transferencia."
                    : "El turno quedó reservado y el pago está pendiente. La agenda se actualizará automáticamente cuando Mercado Pago lo apruebe."
                      : "El pago no se completó y el horario fue liberado. Podés volver a elegir fecha y hora."}
            </DialogDescription>
          </DialogHeader>
          {reservationResult?.date && reservationResult.time && (
            <div className="rounded-xl border border-border bg-card p-4 text-sm">
              {storeSettings?.address && <p className="mb-1"><span className="text-muted-foreground">Dirección: </span>{storeSettings.address}</p>}
              <p><span className="text-muted-foreground">Fecha: </span>{format(parseISO(reservationResult.date), "EEEE d 'de' MMMM yyyy", { locale: es })}</p>
              <p className="mt-1"><span className="text-muted-foreground">Horario: </span>{reservationResult.time}</p>
            </div>
          )}
          <DialogFooter className={reservationResult?.kind === "payment-pending" ? "flex-wrap sm:flex-row sm:justify-end" : reservationResult?.kind === "confirmed" && customer.paymentMethod === "efectivo" ? "sm:justify-between" : undefined}>
            {reservationResult?.kind === "payment-pending" && (
              <>
                <Button
                  type="button"
                  onClick={startNewBooking}
                  className="bg-gold text-primary-foreground hover:bg-gold-soft"
                >
                  Reservar otro turno
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={sendPendingBookingWhatsApp}
                >
                  Enviar comprobante por WhatsApp
                </Button>
                {reservationResult.paymentMethod === "transferencia" ? (
                  <Button
                    type="button"
                    onClick={() => openTransferPaymentDetails(reservationResult)}
                    className="bg-gold text-primary-foreground hover:bg-gold-soft"
                  >
                    Pagar
                  </Button>
                ) : reservationResult.paymentMethod === "tarjeta o mercado pago" ? (
                  <Button
                    type="button"
                    disabled={startingPayment}
                    onClick={() => void startMercadoPagoPayment()}
                    className="bg-gold text-primary-foreground hover:bg-gold-soft"
                  >
                    {startingPayment ? "Preparando pago..." : "Pagar"}
                  </Button>
                ) : null}
              </>
            )}
            {reservationResult?.kind === "confirmed" && customer.paymentMethod === "efectivo" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!storeSettings?.whatsapp) {
                    toast.error("La sucursal todavía no configuró su WhatsApp.");
                    return;
                  }
                  const whatsappUrl = `https://wa.me/${storeSettings.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(createBookingWhatsAppMessage(false))}`;
                  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
                }}
              >
                Avisar reserva por WhatsApp
              </Button>
            )}
            {reservationResult?.kind !== "payment-pending" && (
              <Button
                onClick={startNewBooking}
                className="bg-gold text-primary-foreground hover:bg-gold-soft"
              >
                {reservationResult?.kind === "payment-failure" ? "Sacar turno nuevamente" : "Reservar otro turno"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TransferDetail({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="break-all font-medium">{value}</p></div>
      <Button type="button" size="icon" variant="ghost" aria-label={`Copiar ${label}`} onClick={() => onCopy(value)}><Copy className="h-4 w-4" /></Button>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="w-full rounded-2xl border border-gold/30 bg-card p-3 sm:p-4">
      <div className="mx-auto flex w-fit max-w-full items-center justify-center gap-2 sm:gap-3">
        {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex shrink-0 items-center gap-2">
            <div className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition",
              done && "border-gold bg-gold text-primary-foreground",
              active && "border-gold text-gold",
              !done && !active && "border-border text-muted-foreground"
            )}>
              {done ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={cn("hidden text-xs sm:inline", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <div className={cn("h-px w-4 sm:w-8 md:w-12", done ? "bg-gold" : "bg-border")} />}
          </div>
        );
        })}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-gold">
        <Icon className="h-3 w-3" /> {title}
      </div>
      <h2 className="font-display text-2xl font-semibold">{subtitle}</h2>
    </div>
  );
}

function StepCustomer({ customer, setCustomer, mercadoPagoAvailable }: { customer: Customer; setCustomer: (c: Customer) => void; mercadoPagoAvailable: boolean }) {
  return (
    <div>
      <SectionTitle icon={User} title="Paso 1" subtitle="Tus datos" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre completo *"><Input required value={customer.fullName} onChange={(e) => setCustomer({ ...customer, fullName: e.target.value })} /></Field>
        <Field label="Teléfono *"><Input required value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></Field>
        <Field label="Correo electrónico *"><Input required type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></Field>
        <Field label="Método de pago *">
          <select
            required
            className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            value={customer.paymentMethod ?? ""}
            onChange={(e) => setCustomer({ ...customer, paymentMethod: e.target.value as Customer["paymentMethod"] })}
          >
            <option value="" disabled>Seleccioná un método de pago</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia Bancaria</option>
            {mercadoPagoAvailable && <option value="tarjeta o mercado pago">Tarjeta o MercadoPago</option>}
          </select>
          {!mercadoPagoAvailable && <p className="mt-1 text-xs text-muted-foreground">Tarjeta o Mercado Pago no está disponible en esta sucursal.</p>}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observaciones">
            <Textarea rows={2} value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function StepBarber({ professionals, value, onChange }: { professionals: Professional[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <SectionTitle icon={Briefcase} title="Paso 2" subtitle="Elegí tu profesional" />
      {professionals.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No hay profesionales cargados.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {professionals.map((b) => {
            const selected = value === b.id;
            return (
              <button
                type="button"
                key={b.id}
                onClick={() => onChange(b.id)}
                className={cn(
                  "group flex items-center gap-4 rounded-xl border p-4 text-left transition-all",
                  selected ? "border-gold bg-gold/5 shadow-gold" : "border-border bg-card hover:border-gold/40"
                )}
              >
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-gold/30 to-gold/5 font-display text-lg font-semibold text-gold">
                  {b.name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-lg font-semibold">{b.name}</div>
                  <div className="text-sm text-muted-foreground">{b.specialty}</div>
                  {b.address && <div className="text-sm text-muted-foreground">{b.address}</div>}
                  <div className="mt-1 text-xs text-muted-foreground">{b.services.length} servicios</div>
                </div>
                {selected && <Check className="h-5 w-5 text-gold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepServices({
  value, onChange, professional,
}: {
  value: string[]; onChange: (v: string[]) => void;
  professional?: Professional;
}) {
  const professionalServices = professional?.services ?? [];
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const totalDur = professionalServices.reduce((total, service) => total + (value.includes(service.id) ? service.duration : 0), 0);
  const totalPrice = professionalServices.reduce((total, service) => total + (value.includes(service.id) ? service.price : 0), 0);

  return (
    <div>
      <SectionTitle icon={Star} title="Paso 3" subtitle="Servicios" />
      <p className="mb-4 text-sm text-muted-foreground">Podés seleccionar varios. El tiempo se suma automáticamente.</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {professionalServices.length === 0 ? (
          <div className="rounded-2xl border border-border bg-muted p-6 text-sm text-muted-foreground">
            Seleccioná un profesional para ver sus servicios disponibles.
          </div>
        ) : professionalServices.map((s) => {
          const selected = value.includes(s.id);
          return (
            <button
              type="button"
              key={s.id}
              onClick={() => toggle(s.id)}
              className={cn(
                "flex items-center justify-between rounded-xl border px-4 py-3 text-left transition",
                selected ? "border-gold bg-gold/5" : "border-border bg-card hover:border-gold/30"
              )}
            >
              <div>
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.duration} min</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-display text-base font-semibold text-gold">${s.price.toLocaleString("es-AR")}</span>
                <div className={cn("flex h-5 w-5 items-center justify-center rounded-md border", selected ? "border-gold bg-gold text-primary-foreground" : "border-border")}> 
                  {selected && <Check className="h-3 w-3" />}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {value.length > 0 && (
        <div className="mt-6 flex items-center justify-between rounded-xl border border-gold/30 bg-gold/5 px-5 py-4">
          <div className="text-sm">
            <span className="text-muted-foreground">{value.length} servicio{value.length > 1 ? "s" : ""} · </span>
            <span className="font-medium">{totalDur} min</span>
          </div>
          <div className="font-display text-xl font-semibold text-gold">${totalPrice.toLocaleString("es-AR")}</div>
        </div>
      )}
    </div>
  );
}

function StepDateTime({
  date, setDate, time, setTime, barberId, duration, professional, bookings,
}: {
  date: Date | null; setDate: (d: Date) => void;
  time: string; setTime: (t: string) => void;
  barberId: string; duration: number;
  professional?: Professional;
  bookings: Booking[];
}) {
  const today = startOfToday();
  const scheduledDates = professional?.scheduleDates
    ?.map((entry) => ({ ...entry, parsed: parseISO(entry.date) }))
    .filter((entry) => !Number.isNaN(entry.parsed.getTime()) && entry.parsed >= today && !entry.closed)
    .sort((a, b) => a.parsed.getTime() - b.parsed.getTime());
  const hasWeeklySchedule = (professional?.weeklySchedule?.length ?? 0) > 0;
  const hasSpecificSchedule = (professional?.scheduleDates?.length ?? 0) > 0;
  const days = hasWeeklySchedule
    ? Array.from({ length: 60 }, (_, i) => addDays(today, i)).filter((day) => professional && isProfessionalAvailableOnDate(professional, day))
    : hasSpecificSchedule
      ? scheduledDates?.map((entry) => entry.parsed) ?? []
    : professional?.availableSlots.length
      ? Array.from({ length: 21 }, (_, i) => addDays(today, i))
      : [];
  const professionalSlots = professional?.availableSlots ?? [];
  const dateKey = date ? format(date, "yyyy-MM-dd") : "";
  const slotsNeeded = Math.max(1, Math.ceil(duration / 15));
  const scheduleDay = date && professional ? getScheduleForDate(professional, date) : undefined;
  const slotCapacity = scheduleDay?.capacity ?? 1;
  const slots = scheduleDay
    ? scheduleDay.closed ? [] : generateSlotsFromSchedule(scheduleDay)
    : professionalSlots;

  function fitsSelectedDuration(slot: string): boolean {
    const [h, m] = slot.split(":").map(Number);
    const start = h * 60 + m;
    for (let i = 0; i < slotsNeeded; i++) {
      const t = start + i * 15;
      const key = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      if (!slots.includes(key)) return false;
    }
    return true;
  }

  const hasDurationFit = slots.some(fitsSelectedDuration);

  function remainingForSlot(slot: string): number {
    if (!date) return 0;
    const [hours, minutes] = slot.split(":").map(Number);
    const start = hours * 60 + minutes;
    const end = start + duration;
    const overlappingBookings = bookings.filter((booking) => {
      if (booking.date !== dateKey || booking.barberId !== barberId || booking.status === "cancelled") return false;
      const [bookingHours, bookingMinutes] = booking.time.split(":").map(Number);
      const bookingStart = bookingHours * 60 + bookingMinutes;
      return start < bookingStart + booking.duration && bookingStart < end;
    });
    let maximumOverlapping = 0;
    for (let minute = start; minute < end; minute += 15) {
      const overlapping = overlappingBookings.filter((booking) => {
        const [bookingHours, bookingMinutes] = booking.time.split(":").map(Number);
        const bookingStart = bookingHours * 60 + bookingMinutes;
        return minute < bookingStart + booking.duration && bookingStart < minute + 15;
      }).length;
      maximumOverlapping = Math.max(maximumOverlapping, overlapping);
    }
    return Math.max(0, slotCapacity - maximumOverlapping);
  }

  function isSlotAvailable(slot: string): boolean {
    return fitsSelectedDuration(slot) && remainingForSlot(slot) > 0;
  }

  return (
    <div>
      <SectionTitle icon={CalIcon} title="Paso 4" subtitle="Fecha y horario" />

      <Label className="mb-3 block text-xs uppercase tracking-wider text-muted-foreground">Fecha</Label>
      <div className="-mx-1 flex gap-2 overflow-x-auto pb-3">
        {days.map((d) => {
          const scheduleForDay = professional ? getScheduleForDate(professional, d) : undefined;
          const closed = scheduleForDay
            ? scheduleForDay.closed || generateSlotsFromSchedule(scheduleForDay).length === 0
            : hasSpecificSchedule && !hasWeeklySchedule || professionalSlots.length === 0;
          const selected = date && isSameDay(d, date);
          const past = isBefore(d, today);
          const disabled = closed || past;
          return (
            <button
              type="button"
              key={d.toISOString()}
              disabled={disabled}
              onClick={() => { setDate(d); setTime(""); }}
              className={cn(
                "flex w-16 shrink-0 flex-col items-center rounded-xl border px-2 py-3 transition",
                selected ? "border-gold bg-gold text-primary-foreground" : "border-border bg-card hover:border-gold/40",
                disabled && "cursor-not-allowed opacity-30 hover:border-border"
              )}
            >
              <span className="text-[10px] uppercase tracking-widest">{format(d, "EEE", { locale: es })}</span>
              <span className="font-display text-2xl font-semibold">{format(d, "d")}</span>
              <span className="text-[10px] uppercase">{format(d, "MMM", { locale: es })}</span>
            </button>
          );
        })}
      </div>

      <Label className="mb-3 mt-6 block text-xs uppercase tracking-wider text-muted-foreground">
        Horario {date && <span className="ml-2 normal-case text-muted-foreground/70">({duration} min)</span>}
      </Label>
      {!date ? (
        <p className="text-sm text-muted-foreground">Elegí primero una fecha.</p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay horarios disponibles para esta fecha. Elegí otro día o revisá la disponibilidad del profesional.</p>
      ) : !hasDurationFit ? (
        <p className="text-sm text-muted-foreground">
          Se sobrepasa el turno: la duración seleccionada ({duration} min) no entra en el horario de esta fecha. Elegí un horario anterior o un servicio de menor duración.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
          {slots.map((s) => {
            const durationFits = fitsSelectedDuration(s);
            const avail = isSlotAvailable(s);
            const remaining = remainingForSlot(s);
            const selected = time === s;
            return (
              <button
                type="button"
                key={s}
                disabled={!avail}
                onClick={() => setTime(s)}
                className={cn(
                  "flex flex-col items-center rounded-lg border px-2 py-2 text-sm font-medium transition",
                  selected ? "border-gold bg-gold text-primary-foreground" : "border-border bg-card hover:border-gold/40",
                  !avail && "cursor-not-allowed opacity-25 line-through hover:border-border"
                )}
              >
                <span>{s}</span>
                <span className="text-[10px] font-normal opacity-75">
                  {!durationFits ? "Se sobrepasa el turno" : avail ? `${remaining} disponible${remaining === 1 ? "" : "s"}` : "Completo"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepConfirm({
  professional, storeName, storeCode, storeAddress, customer, serviceIds, date, time, duration, price,
}: {
  professional?: Professional;
  storeName: string; storeCode: string; storeAddress: string;
  customer: Customer; serviceIds: string[];
  date: Date; time: string; duration: number; price: number;
}) {
  const serviceNames = serviceIds
    .map((id) => professional?.services.find((service) => service.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  return (
    <div>
      <SectionTitle icon={Check} title="Paso 5" subtitle="Resumen de tu turno" />
      <div className="grid gap-3 text-sm">
        <Row label="Sucursal" value={`${storeName} · ${storeCode}`} />
        {storeAddress && <Row label="Dirección" value={storeAddress} />}
        <Row label="Cliente" value={customer.fullName} />
        <Row label="Contacto" value={`${customer.email} · ${customer.phone}`} />
        <Row label="Profesional" value={professional?.name ?? "-"} />
        <Row label="Servicios" value={serviceNames || "-"} />
        <Row label="Fecha" value={format(date, "EEEE d 'de' MMMM, yyyy", { locale: es })} />
        <Row label="Horario" value={time} />
        <Row label="Método de pago" value={paymentMethodLabel(customer.paymentMethod)} />
        <Row label="Duración" value={`${duration} min`} icon={Clock} />
        {customer.notes && <Row label="Observaciones" value={customer.notes} />}
      </div>
      <div className="mt-6 flex items-center justify-between rounded-xl border border-gold/30 bg-gold/5 px-5 py-4">
        <span className="text-sm uppercase tracking-wider text-muted-foreground">Precio total</span>
        <span className="font-display text-3xl font-semibold text-gold">${price.toLocaleString("es-AR")}</span>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Una vez confirmado, el horario quedará reservado.
      </p>
    </div>
  );
}

function Row({ label, value, icon: Icon }: { label: string; value: string; icon?: any }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-3 last:border-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-right font-medium">
        {Icon && <Icon className="h-3.5 w-3.5 text-gold" />}
        {value}
      </span>
    </div>
  );
}
