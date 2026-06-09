import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Star, Clock, Calendar as CalIcon, Scissors, User } from "lucide-react";
import { addDays, format, isBefore, isSameDay, startOfToday } from "date-fns";
import { es } from "date-fns/locale";

import { SiteHeader } from "@/components/site-header";
import { WhatsappButton } from "@/components/whatsapp-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { SERVICES, BUSINESS, generateSlots } from "@/lib/salon-data";
import { bookingStore, getBarber, sumDuration, sumPrice, type Customer } from "@/lib/booking-store";
import { professionalStore, getProfessionalServiceList } from "@/lib/professional-store";

export const Route = createFileRoute("/book")({
  head: () => ({
    meta: [
      { title: "Reservar turno" },
      { name: "description", content: "Reservá tu turno en pocos pasos: elegí el rubro profesional, servicio, fecha y horario." },
    ],
  }),
  component: BookPage,
});

const STEPS = ["Datos", "Profesional", "Servicios", "Fecha & hora", "Confirmar"] as const;

function BookPage() {
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<Customer>({
    fullName: "", phone: "", email: "", birthday: "", notes: "", hairType: undefined,
  });
  const [barberId, setBarberId] = useState<string>("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [date, setDate] = useState<Date | null>(null);
  const [time, setTime] = useState<string>("");

  const duration = sumDuration(barberId, serviceIds);
  const price = sumPrice(barberId, serviceIds);

  const canNext = useMemo(() => {
    if (step === 0) return /.+@.+\..+/.test(customer.email) && customer.phone.trim().length >= 6;
    if (step === 1) return !!barberId;
    if (step === 2) return serviceIds.length > 0;
    if (step === 3) return !!date && !!time;
    return true;
  }, [step, customer, barberId, serviceIds, date, time]);

  function confirm() {
    if (!date || !time) {
      toast.error("Seleccioná fecha y horario antes de confirmar.");
      return;
    }
    bookingStore.add({
      customer, barberId, serviceIds,
      date: format(date, "yyyy-MM-dd"),
      time, duration, totalPrice: price,
    });
    toast.success("¡Turno confirmado!");
    navigate({ to: "/" });
  }

  function handleContinue() {
    if (!canNext) {
      let message = "Completá los datos antes de continuar.";

      if (step === 0) {
        if (!/.+@.+\..+/.test(customer.email)) {
          message = "El correo electrónico no es válido.";
        } else if (customer.phone.trim().length < 6) {
          message = "El teléfono debe tener al menos 6 caracteres.";
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

    setStepError(null);
    setStep((s) => s + 1);
  }

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10 md:py-14">
        <Stepper step={step} />

        <div className="mt-8 rounded-2xl border border-border bg-card/60 p-6 md:p-10">
          {step === 0 && <StepCustomer customer={customer} setCustomer={setCustomer} />}
          {step === 1 && <StepBarber value={barberId} onChange={setBarberId} />}
          {step === 2 && <StepServices value={serviceIds} onChange={setServiceIds} hairType={customer.hairType} setHairType={(v) => setCustomer({ ...customer, hairType: v })} barberId={barberId} />}
          {step === 3 && <StepDateTime date={date} setDate={setDate} time={time} setTime={setTime} barberId={barberId} duration={duration} />}
          {step === 4 && <StepConfirm customer={customer} barberId={barberId} serviceIds={serviceIds} date={date!} time={time} duration={duration} price={price} />}
        </div>

        {stepError && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
            {stepError}
          </div>
        )}
        <div className="mt-6 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStep((s) => Math.max(0, s - 1));
              setStepError(null);
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
      <WhatsappButton />
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
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
    <div className="mb-6">
      <div className="mb-2 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-gold">
        <Icon className="h-3 w-3" /> {title}
      </div>
      <h2 className="font-display text-3xl font-semibold">{subtitle}</h2>
    </div>
  );
}

function StepCustomer({ customer, setCustomer }: { customer: Customer; setCustomer: (c: Customer) => void }) {
  return (
    <div>
      <SectionTitle icon={User} title="Paso 1" subtitle="Tus datos" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo *"><Input value={customer.fullName} onChange={(e) => setCustomer({ ...customer, fullName: e.target.value })} placeholder="Juan Pérez" /></Field>
        <Field label="Teléfono *"><Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="+54 11 5555 5555" /></Field>
        <Field label="Correo electrónico *"><Input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} placeholder="vos@email.com" /></Field>
        <Field label="Fecha de nacimiento"><Input type="date" value={customer.birthday} onChange={(e) => setCustomer({ ...customer, birthday: e.target.value })} /></Field>
        <div className="sm:col-span-2">
          <Field label="Observaciones">
            <Textarea rows={3} value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} placeholder="Ej: Quiero mantener el largo / Primera vez" />
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
      <SectionTitle icon={Scissors} title="Paso 2" subtitle="Elegí tu profesional" />
      {professionals.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No hay profesionales cargados. Crealos en el <Link to="/professionals" className="text-gold underline">administrador de profesionales</Link>.
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
                  <div className="mt-1 text-xs text-muted-foreground">{b.availableSlots.length} horarios disponibles · {b.services.length} servicios</div>
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
      <SectionTitle icon={Scissors} title="Paso 3" subtitle="Servicios" />
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
  const days = Array.from({ length: 21 }, (_, i) => addDays(today, i));
  const professional = barberId ? professionalStore.all().find((p) => p.id === barberId) : undefined;
  const professionalSlots = professional?.availableSlots ?? generateSlots();
  const slots = professionalSlots;
  const dateKey = date ? format(date, "yyyy-MM-dd") : "";
  const occupied = date && barberId ? bookingStore.occupiedSlots(dateKey, barberId) : new Set<string>();
  const slotsNeeded = Math.max(1, Math.ceil(duration / 30));

  function isSlotAvailable(slot: string): boolean {
    const [h, m] = slot.split(":").map(Number);
    const start = h * 60 + m;
    for (let i = 0; i < slotsNeeded; i++) {
      const t = start + i * 30;
      const closeMin = BUSINESS.hours.close * 60;
      if (t >= closeMin) return false;
      const key = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
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
          const closed = BUSINESS.closedDays.includes(d.getDay());
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
  customer, barberId, serviceIds, date, time, duration, price,
}: {
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
        <Row label="Cliente" value={customer.fullName} />
        <Row label="Contacto" value={`${customer.email} · ${customer.phone}`} />
        <Row label="Profesional" value={barber?.name ?? "-"} />
        <Row label="Servicios" value={serviceNames || "-"} />
        <Row label="Fecha" value={format(date, "EEEE d 'de' MMMM, yyyy", { locale: es })} />
        <Row label="Hora" value={time} />
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
