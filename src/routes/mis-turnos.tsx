import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import { bookingStore, type Booking } from "@/lib/booking-store";
import { getProfessional, getProfessionalService } from "@/lib/professional-store";
import { toast } from "sonner";
import { LoadingScreen } from "@/components/loading-screen";

export const Route = createFileRoute("/mis-turnos")({
  head: () => ({ meta: [{ title: "Mis turnos" }] }),
  component: MyBookingsPage,
});

function MyBookingsPage() {
  const { isAuthenticated, isLoading, role, user } = useAppAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);

  useEffect(() => {
    const reload = () => {
      const email = user?.email?.trim().toLowerCase();
      setBookings(email ? bookingStore.all().filter((booking) => booking.customer.email.trim().toLowerCase() === email) : []);
    };
    reload();
    window.addEventListener("bookings:changed", reload);
    return () => window.removeEventListener("bookings:changed", reload);
  }, [user?.email]);

  if (isLoading) return <LoadingScreen message="Buscando tus turnos" />;
  if (!isAuthenticated || role !== "client") return <><SiteHeader /><AuthRequired role="client" title="Mis turnos" /></>;

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <p className="text-xs uppercase tracking-widest text-gold">Cuenta de cliente</p>
        <h1 className="font-display text-4xl font-semibold">Mis turnos</h1>
        <p className="mt-2 text-sm text-muted-foreground">Turnos asociados a {user?.email}.</p>
        {bookings.length === 0 ? (
          <section className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground">Todavía no hay turnos asociados a esta cuenta.</p>
            <Button asChild className="mt-4 bg-gold text-primary-foreground hover:bg-gold-soft"><Link to="/reserva">Reservar un turno</Link></Button>
          </section>
        ) : (
          <div className="mt-8 space-y-3">
            {bookings.map((booking) => {
              const professional = getProfessional(booking.barberId);
              const serviceNames = booking.serviceIds.map((id) => getProfessionalService(booking.barberId, id)?.name).filter(Boolean).join(", ");
              const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
              const statusLabel = booking.status === "pending-payment" ? "Pago pendiente" : booking.status === "completed" ? "Asistió" : booking.status === "no-show" ? "No asistió" : booking.status === "cancelled" ? "Cancelado" : "Reservado";
              const statusClass = booking.status === "completed" ? "border-emerald-300 text-emerald-400" : booking.status === "cancelled" || booking.status === "no-show" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-gold/40 text-gold";
              return (
                <article key={booking.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5">
                  <div>
                    <p className="font-semibold">{format(appointmentDate, "EEEE d 'de' MMMM", { locale: es })} · {booking.time}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{professional?.name ?? "Profesional"} · {serviceNames}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={statusClass}>{statusLabel}</Badge>
                    {booking.appointmentConfirmation && <Badge variant="outline" className="border-sky-300 text-sky-300">{booking.appointmentConfirmation === "confirmed" ? "Confirmaste el turno" : "Sin confirmar"}</Badge>}
                    <span className="font-semibold text-gold">${booking.totalPrice.toLocaleString("es-AR")}</span>
                    {booking.status === "confirmed" && booking.appointmentConfirmation !== "confirmed" && (
                      <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => {
                        void bookingStore.update(booking.id, { appointmentConfirmation: "confirmed" })
                          .then(() => toast.success("Confirmaste tu turno."))
                          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "No se pudo guardar la confirmación en la base."));
                      }}>
                        Confirmar turno
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
