import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, isToday, isThisWeek, isThisMonth, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { BarChart3, Calendar, Check, Clock, Scissors, Trash2, TrendingUp, Users, X } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { bookingStore, getBarber, type Booking } from "@/lib/booking-store";
import { BARBERS, SERVICES } from "@/lib/salon-data";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Panel admin — Atelier Barber" }] }),
  component: AdminPage,
});

function AdminPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  useEffect(() => {
    const reload = () => setBookings(bookingStore.all());
    reload();
    window.addEventListener("bookings:changed", reload);
    return () => window.removeEventListener("bookings:changed", reload);
  }, []);

  const stats = useMemo(() => computeStats(bookings), [bookings]);

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-gold">Panel administrador</p>
            <h1 className="font-display text-4xl font-semibold">Agenda & estadísticas</h1>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Calendar} label="Turnos hoy" value={stats.today} />
          <Stat icon={TrendingUp} label="Esta semana" value={stats.week} />
          <Stat icon={Users} label="Clientes únicos" value={stats.uniqueClients} />
          <Stat icon={BarChart3} label="Facturación mes" value={`$${stats.monthRevenue.toLocaleString("es-AR")}`} />
        </div>

        <Tabs defaultValue="agenda" className="mt-10">
          <TabsList>
            <TabsTrigger value="agenda">Agenda</TabsTrigger>
            <TabsTrigger value="stats">Estadísticas</TabsTrigger>
          </TabsList>

          <TabsContent value="agenda" className="mt-6">
            <AgendaList bookings={bookings} />
          </TabsContent>

          <TabsContent value="stats" className="mt-6 grid gap-6 md:grid-cols-2">
            <ChartCard title="Servicios más solicitados" data={stats.servicesChart} />
            <ChartCard title="Turnos por peluquero" data={stats.barbersChart} />
          </TabsContent>
        </Tabs>
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

function AgendaList({ bookings }: { bookings: Booking[] }) {
  const upcoming = bookings.filter((b) => b.status === "confirmed");
  if (!upcoming.length) {
    return <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">No hay turnos confirmados todavía.</p>;
  }
  return (
    <div className="space-y-2">
      {upcoming.map((b) => {
        const barber = getBarber(b.barberId);
        const services = b.serviceIds.map((id) => SERVICES.find((s) => s.id === id)?.name).filter(Boolean).join(", ");
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
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="border-gold/30 text-gold">{barber?.name}</Badge>
                <span>{b.customer.phone}</span>
              </div>
            </div>
            <div className="font-display text-lg font-semibold text-gold">${b.totalPrice.toLocaleString("es-AR")}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { bookingStore.update(b.id, { status: "completed" }); toast.success("Asistencia marcada"); }}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => { bookingStore.update(b.id, { status: "no-show" }); toast("Marcado como ausente"); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => { bookingStore.remove(b.id); toast("Turno eliminado"); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChartCard({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="mb-4 font-display text-lg font-semibold">{title}</h3>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Sin datos aún.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data}>
            <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} />
            <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
              cursor={{ fill: "var(--accent)" }}
            />
            <Bar dataKey="value" fill="var(--gold)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
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

  const svcCount: Record<string, number> = {};
  active.forEach((b) => b.serviceIds.forEach((id) => { svcCount[id] = (svcCount[id] ?? 0) + 1; }));
  const servicesChart = Object.entries(svcCount)
    .map(([id, v]) => ({ name: SERVICES.find((s) => s.id === id)?.name.split(" ")[0] ?? id, value: v }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  const barbCount: Record<string, number> = {};
  active.forEach((b) => { barbCount[b.barberId] = (barbCount[b.barberId] ?? 0) + 1; });
  const barbersChart = BARBERS.map((b) => ({ name: b.name.split(" ")[0], value: barbCount[b.id] ?? 0 }));

  return { today, week, monthRevenue, uniqueClients, servicesChart, barbersChart };
}
