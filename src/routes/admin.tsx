import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  format,
  isToday,
  isThisWeek,
  isThisMonth,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  DollarSign,
  Scissors,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { bookingStore, type Booking } from "@/lib/booking-store";
import {
  professionalStore,
  getProfessional,
  getProfessionalService,
} from "@/lib/professional-store";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ChartCard = lazy(() =>
  import("@/components/admin-charts").then((module) => ({ default: module.ChartCard })),
);
const MonthlyComparisonChart = lazy(() =>
  import("@/components/admin-charts").then((module) => ({
    default: module.MonthlyComparisonChart,
  })),
);

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Estadísticas" }] }),
  component: AdminPage,
});

const STATS_RANGE_STORAGE_KEY = "mi-turno-ya-reservado:admin-stats-range";

type SavedStatsRange = {
  startDate: string;
  endDate: string;
  historySelected: boolean;
};

export function AdminPage() {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [statsReady, setStatsReady] = useState(false);
  const [startDate, setStartDate] = useState(() =>
    format(startOfMonth(subMonths(new Date(), 11)), "yyyy-MM-dd"),
  );
  const [endDate, setEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [rangeDialogOpen, setRangeDialogOpen] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState(startDate);
  const [draftEndDate, setDraftEndDate] = useState(endDate);
  const [historySelected, setHistorySelected] = useState(false);

  useEffect(() => {
    const savedRange = readSavedStatsRange();
    if (savedRange) {
      setStartDate(savedRange.startDate);
      setEndDate(savedRange.endDate);
      setDraftStartDate(savedRange.startDate);
      setDraftEndDate(savedRange.endDate);
      setHistorySelected(savedRange.historySelected);
    }

    const reload = () => {
      setBookings(bookingStore.all());
      setStatsReady(true);
    };
    reload();
    window.addEventListener("bookings:changed", reload);
    return () => window.removeEventListener("bookings:changed", reload);
  }, []);

  const historyBounds = useMemo(() => {
    const dates = bookings.map((booking) => booking.date).filter(Boolean).sort();
    return {
      start: dates[0] ?? startDate,
      end: dates[dates.length - 1] ?? endDate,
    };
  }, [bookings, endDate, startDate]);
  const activeStartDate = historySelected ? historyBounds.start : startDate;
  const activeEndDate = historySelected ? historyBounds.end : endDate;

  const periodBookings = useMemo(
    () =>
      bookings.filter(
        (booking) =>
          isAttendedBooking(booking) &&
          booking.date >= activeStartDate &&
          booking.date <= activeEndDate,
      ),
    [activeEndDate, activeStartDate, bookings],
  );
  const pendingPeriodBookings = useMemo(
    () =>
      bookings.filter(
        (booking) =>
          isPendingAttendanceBooking(booking) &&
              booking.date >= activeStartDate &&
              booking.date <= activeEndDate,
      ),
            [activeEndDate, activeStartDate, bookings],
  );
  const futureRevenue = useMemo(
    () =>
      pendingPeriodBookings
        .filter(
          (booking) =>
            booking.paymentCancellationStatus !== "requested" &&
            booking.paymentCancellationStatus !== "refunded",
        )
        .reduce((total, booking) => total + booking.totalPrice, 0),
    [pendingPeriodBookings],
  );
  const futureServiceCount = pendingPeriodBookings.reduce(
    (total, booking) => total + booking.serviceIds.length,
    0,
  );
  const periodStats = useMemo(
    () => computePeriodStats(bookings, activeStartDate, activeEndDate),
    [activeEndDate, activeStartDate, bookings],
  );
  const periodChartStats = useMemo(() => computeStats(periodBookings), [periodBookings]);
  const validDateRange = Boolean(
    activeStartDate && activeEndDate && activeStartDate <= activeEndDate,
  );

  function openRangeDialog() {
    setDraftStartDate(startDate);
    setDraftEndDate(endDate);
    setRangeDialogOpen(true);
  }

  function applyDateRange() {
    saveStatsRange({
      startDate: draftStartDate,
      endDate: draftEndDate,
      historySelected: false,
    });
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setHistorySelected(false);
    setRangeDialogOpen(false);
  }

  function selectHistory() {
    saveStatsRange({ startDate, endDate, historySelected: true });
    setHistorySelected(true);
    setRangeDialogOpen(false);
  }

  if (isLoading || (isAuthenticated && role === "admin" && !statsReady))
    return <LoadingScreen message="Preparando tus estadísticas" />;
  if (!isAuthenticated || role !== "admin")
    return (
      <>
        <SiteHeader />
        <AuthRequired role="admin" title="Administración" />
      </>
    );

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-10 sm:px-6">
        <section className="space-y-4 rounded-3xl border border-gold/30 bg-card p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gold">Análisis del negocio</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">
                Resumen y evolución mensual
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Compará turnos, servicios e ingresos en el período que elijas.
              </p>
            </div>
            <div className="flex flex-col items-start gap-1 lg:items-end">
              <Button
                type="button"
                variant="outline"
                onClick={openRangeDialog}
                className="h-10 border-gold/30 bg-background px-3 text-sm text-foreground hover:border-gold/60 hover:bg-background"
              >
                <CalendarRange className="text-gold" />
                Seleccionar rango
              </Button>
              <span className="text-xs text-muted-foreground">
                {historySelected
                  ? "Total · histórico"
                  : `${format(parseISO(startDate), "dd/MM/yyyy")} – ${format(parseISO(endDate), "dd/MM/yyyy")}`}
              </span>
            </div>
          </div>

          <Dialog open={rangeDialogOpen} onOpenChange={setRangeDialogOpen}>
            <DialogContent className="border-gold/30 bg-card text-foreground sm:max-w-xl">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Seleccionar rango</DialogTitle>
                <DialogDescription>
                  Elegí un período o consultá todos los datos históricos.
                </DialogDescription>
              </DialogHeader>
              <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <label className="grid gap-1.5 text-sm text-muted-foreground">
                  Desde
                  <input
                    type="date"
                    value={draftStartDate}
                    onChange={(event) => setDraftStartDate(event.target.value)}
                    className="h-10 min-w-0 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground scheme-dark [&::-webkit-calendar-picker-indicator]:invert"
                  />
                </label>
                <label className="grid gap-1.5 text-sm text-muted-foreground">
                  Hasta
                  <input
                    type="date"
                    value={draftEndDate}
                    min={draftStartDate}
                    onChange={(event) => setDraftEndDate(event.target.value)}
                    className="h-10 min-w-0 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground scheme-dark [&::-webkit-calendar-picker-indicator]:invert"
                  />
                </label>
                <Button
                  type="button"
                  onClick={applyDateRange}
                  disabled={!draftStartDate || !draftEndDate || draftStartDate > draftEndDate}
                  className="w-full sm:w-auto"
                >
                  Aplicar rango
                </Button>
              </div>
              <DialogFooter className="justify-start">
                <Button type="button" variant="outline" onClick={selectHistory}>
                  Total · histórico
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              icon={TrendingUp}
              label="Profesional con más atención"
              value={`${periodStats.topBarber.name} · ${periodStats.topBarber.count}`}
            />
            <Stat
              icon={TrendingDown}
              label="Profesional con menos atención"
              value={`${periodStats.lowBarber.name} · ${periodStats.lowBarber.count}`}
            />
            <Stat
              icon={Users}
              label="Último cliente"
              value={periodStats.lastClient}
            />
            <Stat
              icon={Calendar}
              label="Último profesional"
              value={periodStats.lastBarber}
            />
            <Stat
              icon={Scissors}
              label="Profesional con más servicios realizados"
              value={`${periodStats.topServiceBarber.name} · ${periodStats.topServiceBarber.count}`}
            />
            <Stat
              icon={Scissors}
              label="Profesional con menos servicios realizados"
              value={`${periodStats.lowServiceBarber.name} · ${periodStats.lowServiceBarber.count}`}
            />
          </div>

          {validDateRange ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Stat
                  icon={DollarSign}
                  label="Dinero ingresado"
                  value={formatCurrency(periodStats.totalRevenue)}
                />
                <Stat
                  icon={CalendarDays}
                  label="Cantidad total de turnos"
                  value={periodStats.totalTurns.toLocaleString("es-AR")}
                />
                <Stat
                  icon={Scissors}
                  label="Servicios realizados"
                  value={periodStats.totalServices.toLocaleString("es-AR")}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Stat
                  icon={DollarSign}
                  label="Dinero a ingresar a futuro"
                  value={formatCurrency(futureRevenue)}
                />
                <Stat
                  icon={CalendarDays}
                  label="Turnos pendientes de asistencia"
                  value={pendingPeriodBookings.length.toLocaleString("es-AR")}
                />
                <Stat
                  icon={Scissors}
                  label="Servicios pendientes de realizar"
                  value={futureServiceCount.toLocaleString("es-AR")}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Stat
                  icon={TrendingUp}
                  label="Mes con más turnos"
                  value={periodStats.mostBookingsMonth}
                />
                <Stat
                  icon={TrendingUp}
                  label="Mes con más servicios"
                  value={periodStats.mostServicesMonth}
                />
                <Stat
                  icon={TrendingUp}
                  label="Mes con más ingresos"
                  value={periodStats.highestRevenueMonth}
                />
                <Stat
                  icon={TrendingDown}
                  label="Mes con menos turnos"
                  value={periodStats.leastBookingsMonth}
                />
                <Stat
                  icon={TrendingDown}
                  label="Mes con menos servicios"
                  value={periodStats.leastServicesMonth}
                />
                <Stat
                  icon={TrendingDown}
                  label="Mes con menos ingresos"
                  value={periodStats.leastRevenueMonth}
                />
              </div>
              <div className="grid items-stretch gap-4 lg:grid-cols-2">
                <Suspense
                  fallback={
                    <div className="h-80 animate-pulse rounded-2xl border border-gold/30 bg-background/50" />
                  }
                >
                  <MonthlyComparisonChart
                    title="Turnos por mes"
                    data={periodStats.monthly}
                    dataKey="turns"
                    color="#F59E0B"
                  />
                  <MonthlyComparisonChart
                    title="Ingresos por mes"
                    data={periodStats.monthly}
                    dataKey="revenue"
                    color="#34D399"
                    currency
                  />
                </Suspense>
              </div>
              <div className="grid items-stretch gap-4 md:grid-cols-2">
                <Suspense
                  fallback={
                    <div className="h-80 animate-pulse rounded-2xl border border-gold/30 bg-card" />
                  }
                >
                  <ChartCard title="Servicios más solicitados" data={periodChartStats.servicesChart} />
                  <ChartCard title="Turnos por profesionales" data={periodChartStats.barbersChart} />
                </Suspense>
              </div>
            </>
          ) : (
            <p
              role="alert"
              className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200"
            >
              La fecha inicial no puede ser posterior a la fecha final.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Todos los indicadores se actualizan únicamente cuando el profesional confirma la
            asistencia. Los ingresos reflejan los pagos confirmados, descontando devoluciones
            solicitadas o realizadas.
          </p>
        </section>

      </main>
    </div>
  );
}

function readSavedStatsRange(): SavedStatsRange | null {
  try {
    const stored = window.localStorage.getItem(STATS_RANGE_STORAGE_KEY);
    if (!stored) return null;

    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return null;

    const range = parsed as Record<string, unknown>;
    const { startDate, endDate, historySelected } = range;
    if (
      typeof startDate !== "string" ||
      typeof endDate !== "string" ||
      typeof historySelected !== "boolean" ||
      Number.isNaN(parseISO(startDate).getTime()) ||
      Number.isNaN(parseISO(endDate).getTime()) ||
      startDate > endDate
    ) {
      return null;
    }

    return { startDate, endDate, historySelected };
  } catch {
    return null;
  }
}

function saveStatsRange(range: SavedStatsRange) {
  try {
    window.localStorage.setItem(STATS_RANGE_STORAGE_KEY, JSON.stringify(range));
  } catch {
    // Keep the selected range usable even when browser storage is unavailable.
  }
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
}) {
  return (
    <div className="h-38 min-w-0 overflow-hidden rounded-2xl border border-gold/30 bg-card p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gold/15 text-gold">
        <Icon className="h-5 w-5" />
      </div>
      <div className="truncate font-display text-3xl font-semibold" title={String(value)}>
        {value}
      </div>
      <div
        className="mt-1 truncate text-xs uppercase tracking-wider text-muted-foreground"
        title={label}
      >
        {label}
      </div>
    </div>
  );
}

function computeStats(bookings: Booking[]) {
  const attended = bookings.filter(isAttendedBooking);
  const today = attended.filter((b) => isToday(parseISO(b.date))).length;
  const week = attended.filter((b) => isThisWeek(parseISO(b.date), { weekStartsOn: 1 })).length;
  const monthRevenue = attended
    .filter((booking) => isThisMonth(parseISO(booking.date)))
    .reduce((total, booking) => total + getNetReceivedRevenue(booking), 0);
  const uniqueClients = new Set(attended.map((b) => b.customer.email.toLowerCase())).size;

  const allProfessionals = professionalStore.all();
  const serviceLookup = new Map<string, string>();
  const serviceDurationLookup = new Map<string, number>();
  const serviceProfessionalLookup = new Map<string, Set<string>>();
  allProfessionals.forEach((prof) =>
    prof.services.forEach((svc) => {
      serviceLookup.set(svc.id, svc.name);
      serviceDurationLookup.set(svc.id, svc.duration);
    }),
  );

  const svcCount: Record<string, number> = {};
  attended.forEach((booking) =>
    booking.serviceIds.forEach((id) => {
      svcCount[id] = (svcCount[id] ?? 0) + 1;
      const professionalName = getProfessional(booking.barberId)?.name;
      if (!professionalName) return;
      const names = serviceProfessionalLookup.get(id) ?? new Set<string>();
      names.add(professionalName);
      serviceProfessionalLookup.set(id, names);
    }),
  );
  const servicesChart = Object.entries(svcCount)
    .map(([id, v]) => ({
      name: serviceLookup.get(id) ?? getProfessionalService("", id)?.name ?? id,
      value: v,
      subtitle: [
        `${serviceDurationLookup.get(id) ?? getProfessionalService("", id)?.duration ?? 0} min`,
        [...(serviceProfessionalLookup.get(id) ?? [])].join(", "),
      ]
        .filter(Boolean)
        .join(" · "),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const barbCount: Record<string, number> = {};
  allProfessionals.forEach((b) => {
    barbCount[b.id] = 0;
  });
  attended.forEach((b) => {
    barbCount[b.barberId] = (barbCount[b.barberId] ?? 0) + 1;
  });
  const barbersChart = allProfessionals.map((b) => ({
    name: b.name,
    value: barbCount[b.id] ?? 0,
    subtitle: b.specialty || "Profesional",
  }));

  const sortedBarbers = allProfessionals
    .map((b) => ({ name: b.name, count: barbCount[b.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const topBarber = sortedBarbers[0] ?? { name: "-", count: 0 };
  const lowBarber = sortedBarbers[sortedBarbers.length - 1] ?? { name: "-", count: 0 };

  const barberServiceCount: Record<string, number> = {};
  allProfessionals.forEach((professional) => {
    barberServiceCount[professional.id] = 0;
  });
  attended.forEach((booking) => {
    barberServiceCount[booking.barberId] =
      (barberServiceCount[booking.barberId] ?? 0) + booking.serviceIds.length;
  });
  const sortedBarbersByServices = Object.entries(barberServiceCount)
    .map(([id, count]) => ({
      name: getProfessional(id)?.name ?? "Profesional eliminado",
      count,
    }))
    .sort((a, b) => b.count - a.count);
  const topServiceBarber = sortedBarbersByServices[0] ?? { name: "-", count: 0 };
  const lowServiceBarber = sortedBarbersByServices[sortedBarbersByServices.length - 1] ?? {
    name: "-",
    count: 0,
  };

  const lastBooking = [...attended].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  const lastClient = lastBooking?.customer.fullName || "-";
  const lastBarber = lastBooking ? (getProfessional(lastBooking.barberId)?.name ?? "-") : "-";

  return {
    today,
    week,
    monthRevenue,
    uniqueClients,
    servicesChart,
    barbersChart,
    topBarber,
    lowBarber,
    topServiceBarber,
    lowServiceBarber,
    lastClient,
    lastBarber,
  };
}

type MonthlyStats = {
  month: string;
  label: string;
  turns: number;
  services: number;
  revenue: number;
};

function isAttendedBooking(booking: Booking) {
  return booking.status === "completed";
}

function isPendingAttendanceBooking(booking: Booking) {
  return (
    booking.status !== "completed" &&
    booking.status !== "cancelled" &&
    booking.status !== "no-show"
  );
}

function getNetReceivedRevenue(booking: Booking) {
  if (booking.paymentStatus !== "approved") return 0;
  const refund =
    booking.paymentCancellationStatus === "requested" ||
    booking.paymentCancellationStatus === "refunded"
      ? (booking.refundAmount ?? booking.totalPrice)
      : 0;
  return Math.max(0, booking.totalPrice - refund);
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

function formatMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const label = format(new Date(year, monthNumber - 1, 1), "MMM yyyy", { locale: es });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function computePeriodStats(bookings: Booking[], startDate: string, endDate: string) {
  if (!startDate || !endDate || startDate > endDate) {
    return {
      totalRevenue: 0,
      totalTurns: 0,
      totalServices: 0,
      topBarber: { name: "-", count: 0 },
      lowBarber: { name: "-", count: 0 },
      topServiceBarber: { name: "-", count: 0 },
      lowServiceBarber: { name: "-", count: 0 },
      lastClient: "-",
      lastBarber: "-",
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
  const cursor = new Date(Number(startDate.slice(0, 4)), Number(startDate.slice(5, 7)) - 1, 1);
  const last = new Date(Number(endDate.slice(0, 4)), Number(endDate.slice(5, 7)) - 1, 1);
  while (cursor <= last) {
    const month = format(cursor, "yyyy-MM");
    monthly.push({ month, label: formatMonth(month), turns: 0, services: 0, revenue: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const statsByMonth = new Map(monthly.map((entry) => [entry.month, entry]));
  const barberCounts = new Map(
    professionalStore
      .all()
      .map((professional) => [professional.id, { name: professional.name, count: 0 }]),
  );
  const barberServiceCounts = new Map(
    professionalStore
      .all()
      .map((professional) => [professional.id, { name: professional.name, count: 0 }]),
  );
  const attendedInRange = bookings.filter(
    (booking) =>
      isAttendedBooking(booking) && booking.date >= startDate && booking.date <= endDate,
  );
  attendedInRange.forEach((booking) => {
    const month = statsByMonth.get(booking.date.slice(0, 7));
    if (!month) return;
    month.turns += 1;
    month.services += booking.serviceIds.length;
    month.revenue += getNetReceivedRevenue(booking);
    const barber = barberCounts.get(booking.barberId) ?? {
      name: getProfessional(booking.barberId)?.name ?? "Profesional eliminado",
      count: 0,
    };
    barber.count += 1;
    barberCounts.set(booking.barberId, barber);
    const serviceBarber = barberServiceCounts.get(booking.barberId) ?? {
      name: getProfessional(booking.barberId)?.name ?? "Profesional eliminado",
      count: 0,
    };
    serviceBarber.count += booking.serviceIds.length;
    barberServiceCounts.set(booking.barberId, serviceBarber);
  });

  const sortedBarbers = [...barberCounts.values()].sort((a, b) => b.count - a.count);
  const sortedBarbersByServices = [...barberServiceCounts.values()].sort(
    (a, b) => b.count - a.count,
  );
  const lastBooking = [...attendedInRange].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];

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
    topBarber: sortedBarbers[0] ?? { name: "-", count: 0 },
    lowBarber: sortedBarbers[sortedBarbers.length - 1] ?? { name: "-", count: 0 },
    topServiceBarber: sortedBarbersByServices[0] ?? { name: "-", count: 0 },
    lowServiceBarber:
      sortedBarbersByServices[sortedBarbersByServices.length - 1] ?? { name: "-", count: 0 },
    lastClient: lastBooking?.customer.fullName ?? "-",
    lastBarber: lastBooking ? (getProfessional(lastBooking.barberId)?.name ?? "-") : "-",
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
    const isBetter =
      direction === "max" ? month[metric] > best[metric] : month[metric] < best[metric];
    return isBetter ? month : best;
  });
  const value = currency
    ? formatCurrency(selected[metric])
    : selected[metric].toLocaleString("es-AR");
  return `${selected.label} · ${value}`;
}
