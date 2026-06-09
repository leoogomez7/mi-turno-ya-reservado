import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Calendar, Clock, Mail, MapPin, Scissors, User } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { bookingStore, getBarber, type Booking } from "@/lib/booking-store";
import { BUSINESS, SERVICES } from "@/lib/salon-data";

export const Route = createFileRoute("/book/success")({
  validateSearch: (s: Record<string, unknown>) => ({ id: (s.id as string) ?? "" }),
  component: SuccessPage,
});

function SuccessPage() {
  const { id } = Route.useSearch();
  const [booking, setBooking] = useState<Booking | null>(null);

  useEffect(() => {
    setBooking(bookingStore.all().find((b) => b.id === id) ?? null);
  }, [id]);

  if (!booking) {
    return (
      <div className="min-h-screen bg-gradient-dark">
        <SiteHeader />
        <main className="mx-auto max-w-xl px-6 py-20 text-center">
          <p className="text-muted-foreground">No encontramos tu reserva.</p>
          <Button asChild className="mt-6"><Link to="/book">Reservar un turno</Link></Button>
        </main>
      </div>
    );
  }

  const barber = getBarber(booking.barberId);
  const date = new Date(booking.date + "T" + booking.time);
  const services = booking.serviceIds.map((sid) => SERVICES.find((s) => s.id === sid)?.name).filter(Boolean).join(", ");

  function downloadIcs() {
    if (!booking) return;
    const dt = (d: Date) => format(d, "yyyyMMdd'T'HHmmss");
    const end = new Date(date.getTime() + booking.duration * 60000);
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Profesional//ES", "BEGIN:VEVENT",
      `UID:${booking.id}@profesional`,
      `DTSTAMP:${dt(new Date())}`,
      `DTSTART:${dt(date)}`,
      `DTEND:${dt(end)}`,
      `SUMMARY:Turno - ${BUSINESS.name}`,
      `DESCRIPTION:${services} con ${barber?.name ?? ""}`,
      `LOCATION:${BUSINESS.address}`,
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a"); a.href = url; a.download = "turno.ics"; a.click();
  }

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gold/15 text-gold shimmer">
            <Check className="h-10 w-10" />
          </div>
          <h1 className="font-display text-4xl font-semibold md:text-5xl">¡Turno confirmado!</h1>
          <p className="mt-3 text-muted-foreground">
            Te enviamos un correo a <span className="text-foreground">{booking.customer.email}</span> con todos los detalles.
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-border bg-card p-8">
          <div className="grid gap-4 text-sm">
            <Row icon={User} label="Cliente" value={booking.customer.fullName} />
            <Row icon={Scissors} label="Profesional" value={barber?.name ?? "-"} />
            <Row icon={Scissors} label="Servicios" value={services} />
            <Row icon={Calendar} label="Fecha" value={format(date, "EEEE d 'de' MMMM, yyyy", { locale: es })} />
            <Row icon={Clock} label="Hora" value={`${booking.time} (${booking.duration} min)`} />
            <Row icon={MapPin} label="Lugar" value={BUSINESS.address} />
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button onClick={downloadIcs} className="flex-1 bg-gold text-primary-foreground hover:bg-gold-soft">
              <Calendar className="mr-2 h-4 w-4" /> Agregar al calendario
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <Link to="/">Volver al inicio</Link>
            </Button>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Mail className="h-3 w-3" /> Recibirás recordatorios 24h y 2h antes de tu turno.
        </div>
      </main>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-3 last:border-0">
      <span className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-gold" /> {label}
      </span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
