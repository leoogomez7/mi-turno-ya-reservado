import { createFileRoute, Link, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Star, Clock, Calendar as CalIcon, Briefcase, User, LoaderCircle, Copy } from "lucide-react";
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

import { bookingStore, getBarber, sumDuration, sumPrice, type Customer } from "@/lib/booking-store";
import { professionalStore, getProfessionalServiceList, getScheduleForDate, generateSlotsFromSchedule, isProfessionalAvailableOnDate } from "@/lib/professional-store";
import { useAppAuth } from "@/lib/auth";
import { getAvailableStores, getCurrentStoreCode, selectStore, type Store } from "@/lib/cloud-sync";

export const Route = createFileRoute("/book")({
  beforeLoad: () => {
    throw redirect({ to: "/reserva" });
  },
});

const STEPS = ["Datos", "Profesional", "Servicios", "Fecha & hora", "Confirmar"] as const;
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

export function BookPage() {
  const auth = useAppAuth();
  const { isAuthenticated, role, user } = auth;
  const location = useLocation();
  const initialStep = stepForPath(location.pathname) ?? 0;
  const [step, setStep] = useState<number>(Number(initialStep));
  const [stepError, setStepError] = useState<string | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<"transfer" | "mercadopago" | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>(getAvailableStores());
  const [selectedStoreCode, setSelectedStoreCode] = useState(getCurrentStoreCode());
  const [storePickerOpen, setStorePickerOpen] = useState(() => !getCurrentStoreCode());
  const [storeSearch, setStoreSearch] = useState("");
  const [storeSearchSubmitted, setStoreSearchSubmitted] = useState(false);
  const [storeNotFound, setStoreNotFound] = useState(false);
  const [storeLoading, setStoreLoading] = useState(false);
  const navigate = useNavigate();
  const paymentReturn = new URLSearchParams(location.searchStr).get("payment");

  const [customer, setCustomer] = useState<Customer>({
    fullName: "", phone: "", email: "", birthday: "", paymentMethod: "efectivo", notes: "", hairType: undefined,
  });
  const [barberId, setBarberId] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [date, setDate] = useState<Date | null>(null);
  const [time, setTime] = useState("");

  useEffect(() => {
    if (role === "client" && user?.email) {
      setCustomer((current) => current.email ? current : { ...current, email: user.email ?? "" });
    }
  }, [role, user?.email]);

  useEffect(() => {
    const reloadStores = () => {
      setStores(getAvailableStores());
      setSelectedStoreCode(getCurrentStoreCode());
    };
    window.addEventListener("mi-turno-ya:cloud-ready", reloadStores);
    window.addEventListener("mi-turno-ya:store-changed", reloadStores);
    return () => {
      window.removeEventListener("mi-turno-ya:cloud-ready", reloadStores);
      window.removeEventListener("mi-turno-ya:store-changed", reloadStores);
    };
  }, []);

  useEffect(() => {
    if (selectedStoreCode) setStorePickerOpen(false);
  }, [selectedStoreCode]);

  const matchingStores = stores.filter((store) => `${store.name} ${store.code}`.toLowerCase().includes(storeSearch.trim().toLowerCase()));
  const selectedStore = stores.find((store) => store.code === selectedStoreCode);
  const storeSettings = selectedStore?.settings;

  async function chooseStore(store: Store) {
    setStoreLoading(true);
    try {
      if (store.code !== selectedStoreCode) {
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

  const duration = sumDuration(barberId, serviceIds);
  const price = sumPrice(barberId, serviceIds);

  useEffect(() => {
    const pathStep = stepForPath(location.pathname);
    if (pathStep === undefined) return;
    if (Number(pathStep) > 0 && !selectedStoreCode) {
      const message = "Elegí una sucursal para poder continuar con la reserva.";
      setStep(0);
      setStepError(message);
      setStorePickerOpen(true);
      navigate({ to: "/reserva" });
      return;
    }
    setStep(Number(pathStep));
  }, [location.pathname, navigate, selectedStoreCode]);

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
    if (isAuthenticated && role === "client" && user?.email && customer.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      toast.error("Para ver este turno en tu cuenta, usá el mismo correo con el que iniciaste sesión.");
      return;
    }
    if (!date || !time) {
      toast.error("Seleccioná fecha y horario antes de confirmar.");
      return;
    }

    const barber = getBarber(barberId);
    const serviceNames = getProfessionalServiceList(barberId)
      .filter((s) => serviceIds.includes(s.id))
      .map((s) => s.name)
      .join(", ");
    const message = `Hola! Quiero confirmar un turno.
  Sucursal: ${stores.find((store) => store.code === selectedStoreCode)?.name ?? selectedStoreCode} (${selectedStoreCode})
Nombre: ${customer.fullName}
Teléfono: ${customer.phone}
Email: ${customer.email}
Profesional: ${barber?.name ?? ""}
Servicios: ${serviceNames}
Fecha: ${format(date, "EEEE d 'de' MMMM yyyy", { locale: es })}
Horario: ${time}
Método de pago: ${customer.paymentMethod ?? "Efectivo"}
Precio total: $${price}
Notas: ${customer.notes || "Ninguna"}`;

    if (customer.paymentMethod === "transferencia") {
      try {
        await bookingStore.add({
        storeCode: selectedStoreCode,
        customer, barberId, serviceIds,
        date: format(date, "yyyy-MM-dd"),
        time, duration, totalPrice: price, status: "pending-payment",
        });
        setPaymentDialog("transfer");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo guardar el turno.");
      }
      return;
    }

    if (["tarjeta de crédito", "tarjeta de débito", "mercadopago"].includes(customer.paymentMethod ?? "")) {
      setPaymentDialog("mercadopago");
      setPaymentLoading(true);
      setPaymentUrl(null);
      setPaymentError(null);
      try {
        const response = await fetch("/api/mercadopago/preference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: price,
            description: serviceNames || "Reserva de turno",
            email: customer.email,
            customerName: customer.fullName,
            reservationDate: format(date, "yyyy-MM-dd"),
            reservationTime: time,
          }),
        });
        const result = await response.json() as { initPoint?: string; error?: string };
        if (!response.ok || !result.initPoint) {
          throw new Error(result.error || "No se pudo preparar el pago.");
        }
        await bookingStore.add({
          storeCode: selectedStoreCode,
          customer, barberId, serviceIds,
          date: format(date, "yyyy-MM-dd"),
          time, duration, totalPrice: price, status: "pending-payment",
        });
        setPaymentUrl(result.initPoint);
        window.setTimeout(() => window.location.assign(result.initPoint!), 1200);
      } catch (error) {
        setPaymentError(error instanceof Error ? error.message : "No se pudo preparar el pago.");
      } finally {
        setPaymentLoading(false);
      }
      return;
    }

    try {
      await bookingStore.add({
        storeCode: selectedStoreCode,
        customer, barberId, serviceIds,
        date: format(date, "yyyy-MM-dd"),
        time, duration, totalPrice: price,
      });
      if (storeSettings?.whatsapp) {
        const whatsappUrl = `https://wa.me/${storeSettings.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, "_blank");
      }
      toast.success("¡Turno guardado!");
      navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el turno.");
    }
  }

  function sendTransferConfirmation() {
    if (!storeSettings?.whatsapp) {
      toast.error("La sucursal todavía no configuró su WhatsApp.");
      return;
    }
    const message = `Hola, quiero enviar el comprobante de transferencia de mi turno por $${price.toLocaleString("es-AR")}. Nombre: ${customer.fullName}, fecha: ${date ? format(date, "dd/MM/yyyy") : ""}, horario: ${time}.`;
    window.open(`https://wa.me/${storeSettings.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`, "_blank");
    setPaymentDialog(null);
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
    if (!selectedStoreCode) {
      const message = "Elegí una sucursal para poder continuar con la reserva.";
      setStepError(message);
      setStorePickerOpen(true);
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

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-col px-4 py-10 sm:px-6">
        <section
          className={cn(
            "mb-4 rounded-2xl border border-gold/30 bg-card p-4 sm:p-5",
            !selectedStoreCode && "cursor-pointer transition-colors hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
          )}
          role={!selectedStoreCode ? "button" : undefined}
          tabIndex={!selectedStoreCode ? 0 : undefined}
          aria-label={!selectedStoreCode ? "Buscar sucursal para reservar" : undefined}
          onClick={() => {
            if (!selectedStoreCode) setStorePickerOpen(true);
          }}
          onKeyDown={(event) => {
            if (!selectedStoreCode && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              setStorePickerOpen(true);
            }
          }}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-gold">{selectedStoreCode ? "Sucursal seleccionada" : "Antes de reservar"}</p>
              <h2 className="mt-1 font-display text-xl font-semibold">
                {selectedStoreCode
                  ? stores.find((store) => store.code === selectedStoreCode)?.name ?? selectedStoreCode
                  : "Seleccioná una sucursal · Tocá aquí para buscar"}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              {selectedStoreCode && <p className="text-xs text-muted-foreground">Código: {selectedStoreCode}</p>}
              {selectedStoreCode && <Button type="button" size="sm" className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => setStorePickerOpen(true)}>Cambiar sucursal</Button>}
            </div>
          </div>
        </section>
        <Dialog open={storePickerOpen} onOpenChange={(open) => {
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
              <Button type="button" disabled={storeLoading || !storeSearch.trim()} className="w-full bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => {
                setStoreSearchSubmitted(true);
                setStoreNotFound(matchingStores.length === 0);
                if (matchingStores.length === 1) void chooseStore(matchingStores[0]);
              }}>
                {storeLoading ? "Cargando sucursal…" : "Buscar sucursal"}
              </Button>
              {storeSearchSubmitted && storeNotFound && <p role="status" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">No encontramos sucursales con ese nombre o código.</p>}
            </div>
          </DialogContent>
        </Dialog>
        {paymentReturn && (
          <div role="status" className="mb-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-foreground">
            {paymentReturn === "success"
              ? "Mercado Pago informó que el pago fue aprobado. El turno queda pendiente hasta que administración verifique la acreditación."
              : paymentReturn === "pending"
                ? "El pago está pendiente de acreditación. El turno se confirmará cuando administración lo verifique."
                : "El pago no se completó. Podés volver a intentarlo desde este paso."}
          </div>
        )}
        <Stepper step={step} />

        <div className="mt-4 rounded-2xl border border-gold/30 bg-card p-5 sm:p-6">
          {step === 0 && <StepCustomer customer={customer} setCustomer={setCustomer} />}
          {step === 1 && <StepBarber value={barberId} onChange={setBarberId} />}
          {step === 2 && <StepServices value={serviceIds} onChange={setServiceIds} hairType={customer.hairType} setHairType={(v) => setCustomer({ ...customer, hairType: v })} barberId={barberId} />}
          {step === 3 && <StepDateTime date={date} setDate={setDate} time={time} setTime={setTime} barberId={barberId} duration={duration} />}
          {step === 4 && (date ? <StepConfirm storeName={stores.find((store) => store.code === selectedStoreCode)?.name ?? selectedStoreCode} storeCode={selectedStoreCode} customer={customer} barberId={barberId} serviceIds={serviceIds} date={date} time={time} duration={duration} price={price} /> : <p className="py-8 text-center text-sm text-muted-foreground">Seleccioná fecha y horario para ver el resumen.</p>)}
        </div>

        {stepError && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {stepError}
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
            <Button type="button" onClick={confirm} className="h-12 bg-gold px-8 text-base font-semibold text-primary-foreground shadow-gold hover:bg-gold-soft">
              CONFIRMAR TURNO
            </Button>
          )}
        </div>
      </main>
      <Dialog open={paymentDialog !== null} onOpenChange={(open) => { if (!open && !paymentLoading) setPaymentDialog(null); }}>
        <DialogContent>
          {paymentDialog === "transfer" ? (
            <>
              <DialogHeader>
                <DialogTitle>Datos para la transferencia</DialogTitle>
                <DialogDescription>Transferí el total de ${price.toLocaleString("es-AR")} y envianos el comprobante para confirmar tu turno.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
                <TransferDetail label="Titular" value={storeSettings?.transferHolder ?? ""} onCopy={copyTransferValue} />
                <TransferDetail label="Banco" value={storeSettings?.transferBank ?? ""} onCopy={copyTransferValue} />
                <TransferDetail label="CBU" value={storeSettings?.transferCbu ?? ""} onCopy={copyTransferValue} />
                <TransferDetail label="Alias" value={storeSettings?.transferAlias ?? ""} onCopy={copyTransferValue} />
              </div>
              <DialogFooter>
                <Button onClick={sendTransferConfirmation} className="bg-gold text-primary-foreground hover:bg-gold-soft">Enviar comprobante por WhatsApp</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Preparando el pago</DialogTitle>
                <DialogDescription>Estamos recalculando y preparando el checkout seguro de Mercado Pago.</DialogDescription>
              </DialogHeader>
              {paymentLoading ? (
                <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground"><LoaderCircle className="h-5 w-5 animate-spin text-gold" /> Recalculando el total…</div>
              ) : paymentError ? (
                <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{paymentError}</p>
              ) : paymentUrl ? (
                <Button asChild className="bg-gold text-primary-foreground hover:bg-gold-soft"><a href={paymentUrl}>Ir a pagar</a></Button>
              ) : null}
            </>
          )}
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
    <div className="mx-auto flex w-full items-center justify-center gap-2 rounded-2xl border border-gold/30 bg-card p-3 sm:gap-3 sm:p-4">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition",
              done && "border-gold bg-gold text-primary-foreground",
              active && "border-gold text-gold",
              !done && !active && "border-border text-muted-foreground"
            )}>
              {done ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={cn("hidden text-xs sm:inline", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <div className={cn("h-px flex-1", done ? "bg-gold" : "bg-border")} />}
          </div>
        );
      })}
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

function StepCustomer({ customer, setCustomer }: { customer: Customer; setCustomer: (c: Customer) => void }) {
  return (
    <div>
      <SectionTitle icon={User} title="Paso 1" subtitle="Tus datos" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre completo *"><Input required value={customer.fullName} onChange={(e) => setCustomer({ ...customer, fullName: e.target.value })} placeholder="Juan Pérez" /></Field>
        <Field label="Teléfono *"><Input required value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="+54 11 5555 5555" /></Field>
        <Field label="Correo electrónico *"><Input required type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} placeholder="vos@email.com" /></Field>
        <Field label="Método de pago *">
          <select
            required
            className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            value={customer.paymentMethod ?? "efectivo"}
            onChange={(e) => setCustomer({ ...customer, paymentMethod: e.target.value as Customer["paymentMethod"] })}
          >
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta de crédito">Tarjeta de crédito</option>
            <option value="tarjeta de débito">Tarjeta de débito</option>
            <option value="mercadopago">Mercado Pago</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observaciones">
            <Textarea rows={2} value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} placeholder="Ej: ¿Puedo ir acompañado? / ¿Hay televisión?" />
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

function StepBarber({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const professionals = professionalStore.all();

  return (
    <div>
      <SectionTitle icon={Briefcase} title="Paso 2" subtitle="Elegí tu profesional" />
      {professionals.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No hay profesionales cargados. Crealos en <Link to="/configuracion" className="text-gold underline">Configuración</Link>.
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
                  <div className="mt-1 text-xs text-muted-foreground">{b.scheduleDates?.length ?? b.availableSlots.length} fechas disponibles · {b.services.length} servicios</div>
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
  value, onChange, hairType, setHairType, barberId,
}: {
  value: string[]; onChange: (v: string[]) => void;
  hairType?: Customer["hairType"]; setHairType: (v: Customer["hairType"]) => void;
  barberId: string;
}) {
  const professionalServices = getProfessionalServiceList(barberId);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const totalDur = sumDuration(barberId, value);
  const totalPrice = sumPrice(barberId, value);

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

      <div className="mt-8">
        <Label className="mb-3 block text-xs uppercase tracking-wider text-muted-foreground">Tipo de cabello</Label>
        <div className="flex flex-wrap gap-2">
          {(["corto", "medio", "largo"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setHairType(t)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm capitalize transition",
                hairType === t ? "border-gold bg-gold text-primary-foreground" : "border-border bg-card hover:border-gold/40"
              )}
            >{t}</button>
          ))}
        </div>
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
  date, setDate, time, setTime, barberId, duration,
}: {
  date: Date | null; setDate: (d: Date) => void;
  time: string; setTime: (t: string) => void;
  barberId: string; duration: number;
}) {
  const today = startOfToday();
  const professional = barberId ? professionalStore.all().find((p) => p.id === barberId) : undefined;
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
  const occupied = date && barberId ? bookingStore.occupiedSlots(dateKey, barberId) : new Set<string>();
  const slotsNeeded = Math.max(1, Math.ceil(duration / 30));
  const scheduleDay = date && professional ? getScheduleForDate(professional, date) : undefined;
  const slots = scheduleDay
    ? scheduleDay.closed ? [] : generateSlotsFromSchedule(scheduleDay)
    : professionalSlots;

  function isSlotAvailable(slot: string): boolean {
    const [h, m] = slot.split(":").map(Number);
    const start = h * 60 + m;
    for (let i = 0; i < slotsNeeded; i++) {
      const t = start + i * 30;
      const key = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      if (!slots.includes(key)) return false;
      if (occupied.has(key)) return false;
    }
    return true;
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
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
          {slots.map((s) => {
            const avail = isSlotAvailable(s);
            const selected = time === s;
            return (
              <button
                type="button"
                key={s}
                disabled={!avail}
                onClick={() => setTime(s)}
                className={cn(
                  "rounded-lg border py-2.5 text-sm font-medium transition",
                  selected ? "border-gold bg-gold text-primary-foreground" : "border-border bg-card hover:border-gold/40",
                  !avail && "cursor-not-allowed opacity-25 line-through hover:border-border"
                )}
              >
                {s}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepConfirm({
  storeName, storeCode, customer, barberId, serviceIds, date, time, duration, price,
}: {
  storeName: string; storeCode: string;
  customer: Customer; barberId: string; serviceIds: string[];
  date: Date; time: string; duration: number; price: number;
}) {
  const barber = getBarber(barberId);
  const serviceNames = serviceIds
    .map((id) => getProfessionalServiceList(barberId).find((s) => s.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  return (
    <div>
      <SectionTitle icon={Check} title="Paso 5" subtitle="Resumen de tu turno" />
      <div className="grid gap-3 text-sm">
        <Row label="Sucursal" value={`${storeName} · ${storeCode}`} />
        <Row label="Cliente" value={customer.fullName} />
        <Row label="Contacto" value={`${customer.email} · ${customer.phone}`} />
        <Row label="Profesional" value={barber?.name ?? "-"} />
        <Row label="Servicios" value={serviceNames || "-"} />
        <Row label="Fecha" value={format(date, "EEEE d 'de' MMMM, yyyy", { locale: es })} />
        <Row label="Hora" value={time} />
        <Row label="Método de pago" value={customer.paymentMethod ?? "Efectivo"} />
        <Row label="Duración" value={`${duration} min`} icon={Clock} />
        {customer.notes && <Row label="Observaciones" value={customer.notes} />}
      </div>
      <div className="mt-6 flex items-center justify-between rounded-xl border border-gold/30 bg-gold/5 px-5 py-4">
        <span className="text-sm uppercase tracking-wider text-muted-foreground">Total estimado</span>
        <span className="font-display text-3xl font-semibold text-gold">${price.toLocaleString("es-AR")}</span>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Una vez confirmado, el horario quedará reservado y te enviaremos un recordatorio.
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
