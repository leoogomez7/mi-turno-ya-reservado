import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, isToday, isThisWeek, isThisMonth, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { BarChart3, Calendar, Check, Clock, Scissors, Trash2, TrendingUp, Users, X } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, TooltipProps } from "recharts";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { bookingStore, getBarber, type Booking } from "@/lib/booking-store";
import { professionalStore, getProfessional, getProfessionalService, type Professional } from "@/lib/professional-store";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Panel" }] }),
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
            <h1 className="font-display text-4xl font-semibold">Agenda & Estadísticas</h1>
          </div>
        </div>

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
            <AgendaList bookings={bookings} />
          </TabsContent>

          <TabsContent value="stats" className="mt-6 grid gap-6 md:grid-cols-2">
            <ChartCard title="Servicios más solicitados" data={stats.servicesChart} />
            <ChartCard title="Turnos por profesionales" data={stats.barbersChart} />
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
