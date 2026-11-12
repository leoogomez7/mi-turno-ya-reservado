import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { format, isToday, isThisWeek, isThisMonth, parseISO, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar, CalendarDays, DollarSign, Scissors, TrendingDown, TrendingUp, Users, type LucideIcon } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { bookingStore, type Booking } from "@/lib/booking-store";
import { professionalStore, getProfessional, getProfessionalService } from "@/lib/professional-store";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import { LoadingScreen } from "@/components/loading-screen";

const ChartCard = lazy(() => import("@/components/admin-charts").then((module) => ({ default: module.ChartCard })));
const MonthlyComparisonChart = lazy(() => import("@/components/admin-charts").then((module) => ({ default: module.MonthlyComparisonChart })));

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Estadísticas" }] }),
  component: AdminPage,
});

export function AdminPage() {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [statsReady, setStatsReady] = useState(false);
  const [startMonth, setStartMonth] = useState(() => format(subMonths(new Date(), 11), "yyyy-MM"));
  const [endMonth, setEndMonth] = useState(() => format(new Date(), "yyyy-MM"));

  useEffect(() => {
    const reload = () => {
      setBookings(bookingStore.all());
      setStatsReady(true);
    };
    reload();
    window.addEventListener("bookings:changed", reload);
    return () => window.removeEventListener("bookings:changed", reload);
  }, []);

  const stats = useMemo(() => computeStats(bookings), [bookings]);
  const periodStats = useMemo(() => computePeriodStats(bookings, startMonth, endMonth), [bookings, endMonth, startMonth]);
  const validMonthRange = startMonth <= endMonth;

  if (isLoading || (isAuthenticated && role === "admin" && !statsReady)) return <LoadingScreen message="Preparando tus estadísticas" />;
  if (!isAuthenticated || role !== "admin") return <><SiteHeader /><AuthRequired role="admin" title="Administración" /></>;

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-10 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={TrendingUp} label="Profesional con más atención" value={`${stats.topBarber.name} · ${stats.topBarber.count}`} />
          <Stat icon={TrendingDown} label="Profesional con menos atención" value={`${stats.lowBarber.name} · ${stats.lowBarber.count}`} />
          <Stat icon={Users} label="Último cliente" value={stats.lastClient} />
          <Stat icon={Calendar} label="Último profesional" value={stats.lastBarber} />
        </div>

        <section className="space-y-4 rounded-3xl border border-gold/30 bg-card p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gold">Análisis del negocio</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">Resumen y evolución mensual</h2>
              <p className="mt-1 text-sm text-muted-foreground">Compará turnos, servicios e ingresos en el período que elijas.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
              <label className="grid gap-1 text-xs text-muted-foreground">
                Desde
                <input type="month" value={startMonth} max={endMonth} onChange={(event) => setStartMonth(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground scheme-dark" />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Hasta
                <input type="month" value={endMonth} min={startMonth} max={format(new Date(), "yyyy-MM")} onChange={(event) => setEndMonth(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground scheme-dark" />
              </label>
            </div>
          </div>

          {validMonthRange ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Stat icon={DollarSign} label="Dinero ingresado" value={formatCurrency(periodStats.totalRevenue)} />
                <Stat icon={CalendarDays} label="Cantidad total de turnos" value={periodStats.totalTurns.toLocaleString("es-AR")} />
                <Stat icon={Scissors} label="Servicios realizados" value={periodStats.totalServices.toLocaleString("es-AR")} />
                <Stat icon={TrendingUp} label="Mes con más turnos" value={periodStats.mostBookingsMonth} />
                <Stat icon={TrendingUp} label="Mes con más servicios" value={periodStats.mostServicesMonth} />
                <Stat icon={TrendingUp} label="Mes con más ingresos" value={periodStats.highestRevenueMonth} />
                <Stat icon={TrendingDown} label="Mes con menos turnos" value={periodStats.leastBookingsMonth} />
                <Stat icon={TrendingDown} label="Mes con menos servicios" value={periodStats.leastServicesMonth} />
                <Stat icon={TrendingDown} label="Mes con menos ingresos" value={periodStats.leastRevenueMonth} />
              </div>
              <div className="grid items-stretch gap-4 lg:grid-cols-2">
                <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl border border-gold/30 bg-background/50" />}>
                  <MonthlyComparisonChart title="Turnos por mes" data={periodStats.monthly} dataKey="turns" color="#F59E0B" />
                  <MonthlyComparisonChart title="Ingresos por mes" data={periodStats.monthly} dataKey="revenue" color="#34D399" currency />
                </Suspense>
              </div>
            </>
          ) : (
            <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">El mes inicial no puede ser posterior al mes final.</p>
          )}
          <p className="text-xs text-muted-foreground">No se cuentan turnos cancelados o liberados ni ausencias sin pago aprobado. Los ingresos corresponden a turnos asistidos o con pago aprobado.</p>
        </section>

        <div className="grid items-stretch gap-4 md:grid-cols-2">
          <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl border border-gold/30 bg-card" />}>
            <ChartCard title="Servicios más solicitados" data={stats.servicesChart} />
            <ChartCard title="Turnos por profesionales" data={stats.barbersChart} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-gold/30 bg-card p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gold/15 text-gold">
        <Icon className="h-5 w-5" />
      </div>
      <div className="font-display text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function computeStats(bookings: Booking[]) {
  const active = bookings.filter(isCountableBooking);
  const today = active.filter((b) => isToday(parseISO(b.date))).length;
  const week = active.filter((b) => isThisWeek(parseISO(b.date), { weekStartsOn: 1 })).length;
  const monthBookings = active.filter((b) => isThisMonth(parseISO(b.date)));
  const monthRevenue = monthBookings.filter(hasReceivedPayment).reduce((a, b) => a + b.totalPrice, 0);
  const uniqueClients = new Set(active.map((b) => b.customer.email.toLowerCase())).size;

  const allProfessionals = professionalStore.all();
  const serviceLookup = new Map<string, string>();
  const serviceDurationLookup = new Map<string, number>();
  const serviceProfessionalLookup = new Map<string, Set<string>>();
  allProfessionals.forEach((prof) => prof.services.forEach((svc) => {
    serviceLookup.set(svc.id, svc.name);
    serviceDurationLookup.set(svc.id, svc.duration);
  }));

  const svcCount: Record<string, number> = {};
  active.forEach((booking) => booking.serviceIds.forEach((id) => {
    svcCount[id] = (svcCount[id] ?? 0) + 1;
    const professionalName = getProfessional(booking.barberId)?.name;
    if (!professionalName) return;
    const names = serviceProfessionalLookup.get(id) ?? new Set<string>();
    names.add(professionalName);
    serviceProfessionalLookup.set(id, names);
  }));
  const servicesChart = Object.entries(svcCount)
    .map(([id, v]) => ({
      name: serviceLookup.get(id) ?? getProfessionalService("", id)?.name ?? id,
      value: v,
      subtitle: [
        `${serviceDurationLookup.get(id) ?? getProfessionalService("", id)?.duration ?? 0} min`,
        [...(serviceProfessionalLookup.get(id) ?? [])].join(", "),
      ].filter(Boolean).join(" · "),
    }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  const barbCount: Record<string, number> = {};
  allProfessionals.forEach((b) => { barbCount[b.id] = 0; });
  active.forEach((b) => { barbCount[b.barberId] = (barbCount[b.barberId] ?? 0) + 1; });
  const barbersChart = allProfessionals.map((b) => ({
    name: b.name,
    value: barbCount[b.id] ?? 0,
    subtitle: b.specialty || "Profesional",
  }));

  const sortedBarbers = allProfessionals.map((b) => ({ name: b.name, count: barbCount[b.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const topBarber = sortedBarbers[0] ?? { name: "-", count: 0 };
  const lowBarber = sortedBarbers[sortedBarbers.length - 1] ?? { name: "-", count: 0 };

  const lastBooking = [...active].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const lastClient = lastBooking?.customer.fullName || "-";
  const lastBarber = lastBooking ? getProfessional(lastBooking.barberId)?.name ?? "-" : "-";

  return { today, week, monthRevenue, uniqueClients, servicesChart, barbersChart, topBarber, lowBarber, lastClient, lastBarber };
}

type MonthlyStats = { month: string; label: string; turns: number; services: number; revenue: number };

function isCountableBooking(booking: Booking) {
  if (booking.status === "cancelled" || booking.paymentCancellationStatus === "cancelled" || booking.paymentCancellationStatus === "refunded") return false;
  return booking.status !== "no-show" || booking.paymentStatus === "approved";
}

function hasReceivedPayment(booking: Booking) {
  return booking.status === "completed" || booking.paymentStatus === "approved";
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

function formatMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const label = format(new Date(year, monthNumber - 1, 1), "MMM yyyy", { locale: es });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function computePeriodStats(bookings: Booking[], startMonth: string, endMonth: string) {
  if (!startMonth || !endMonth || startMonth > endMonth) {
    return {
      totalRevenue: 0,
      totalTurns: 0,
      totalServices: 0,
      mostBookingsMonth: "—",
      mostServicesMonth: "—",
      highestRevenueMonth: "—",
      leastBookingsMonth: "—",
      leastServicesMonth: "—",
      leastRevenueMonth: "—",
      monthly: [] as MonthlyStats[],
    };
  }

  const monthly: MonthlyStats[] = [];
  const cursor = new Date(Number(startMonth.slice(0, 4)), Number(startMonth.slice(5, 7)) - 1, 1);
  const last = new Date(Number(endMonth.slice(0, 4)), Number(endMonth.slice(5, 7)) - 1, 1);
  while (cursor <= last) {
    const month = format(cursor, "yyyy-MM");
    monthly.push({ month, label: formatMonth(month), turns: 0, services: 0, revenue: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const statsByMonth = new Map(monthly.map((entry) => [entry.month, entry]));
  bookings.filter(isCountableBooking).forEach((booking) => {
    const month = statsByMonth.get(booking.date.slice(0, 7));
    if (!month) return;
    month.turns += 1;
    month.services += booking.serviceIds.length;
    if (hasReceivedPayment(booking)) month.revenue += booking.totalPrice;
  });

  const mostBookingsMonth = formatMonthMetric(monthly, "turns", "max");
  const mostServicesMonth = formatMonthMetric(monthly, "services", "max");
  const highestRevenueMonth = formatMonthMetric(monthly, "revenue", "max", true);
  const leastBookingsMonth = formatMonthMetric(monthly, "turns", "min");
  const leastServicesMonth = formatMonthMetric(monthly, "services", "min");
  const leastRevenueMonth = formatMonthMetric(monthly, "revenue", "min", true);

  return {
    totalRevenue: monthly.reduce((total, month) => total + month.revenue, 0),
    totalTurns: monthly.reduce((total, month) => total + month.turns, 0),
    totalServices: monthly.reduce((total, month) => total + month.services, 0),
    mostBookingsMonth,
    mostServicesMonth,
    highestRevenueMonth,
    leastBookingsMonth,
    leastServicesMonth,
    leastRevenueMonth,
    monthly,
  };
}

function formatMonthMetric(
  months: MonthlyStats[],
  metric: "turns" | "services" | "revenue",
  direction: "min" | "max",
  currency = false,
) {
  if (!months.some((month) => month[metric] > 0)) return "Sin datos";
  const selected = months.reduce((best, month) => {
    const isBetter = direction === "max" ? month[metric] > best[metric] : month[metric] < best[metric];
    return isBetter ? month : best;
  });
  const value = currency ? formatCurrency(selected[metric]) : selected[metric].toLocaleString("es-AR");
  return `${selected.label} · ${value}`;
}
