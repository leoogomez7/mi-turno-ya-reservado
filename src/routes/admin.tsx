import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { isToday, isThisWeek, isThisMonth, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar, TrendingDown, TrendingUp, Users } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { bookingStore, type Booking } from "@/lib/booking-store";
import { professionalStore, getProfessional, getProfessionalService } from "@/lib/professional-store";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import { LoadingScreen } from "@/components/loading-screen";

const ChartCard = lazy(() => import("@/components/admin-charts").then((module) => ({ default: module.ChartCard })));

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Estadísticas" }] }),
  component: AdminPage,
});

export function AdminPage() {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);

  useEffect(() => {
    const reload = () => setBookings(bookingStore.all());
    reload();
    window.addEventListener("bookings:changed", reload);
    return () => window.removeEventListener("bookings:changed", reload);
  }, []);

  const stats = useMemo(() => computeStats(bookings), [bookings]);

  if (isLoading) return <LoadingScreen message="Preparando tu agenda" />;
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

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
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
