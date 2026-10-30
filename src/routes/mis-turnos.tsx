import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { AuthRequired } from "@/components/auth-required";
import { useAppAuth } from "@/lib/auth";
import type { Booking } from "@/lib/booking-store";
import type { Professional } from "@/lib/professional-store";
import { confirmClientBooking, getClientBookings } from "@/lib/cloud-sync";
import { toast } from "sonner";
import { LoadingScreen } from "@/components/loading-screen";

export const Route = createFileRoute("/mis-turnos")({
  head: () => ({ meta: [{ title: "Mis turnos" }] }),
  component: MyBookingsPage,
});

function MyBookingsPage() {
  const { isAuthenticated, isLoading, role, user } = useAppAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [confirmationBusyId, setConfirmationBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await getClientBookings();
      setBookings(result.bookings);
      setProfessionals(result.professionals);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar tus turnos.");
    } finally {
      setLoadingBookings(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || role !== "client") return;
    void reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [isAuthenticated, reload, role]);

  async function confirmBooking(bookingId: string) {
    if (confirmationBusyId) return;
    setConfirmationBusyId(bookingId);
    try {
      const result = await confirmClientBooking(bookingId);
      setBookings((current) => current.map((booking) => booking.id === bookingId ? result.booking : booking));
      toast.success("Confirmaste tu turno.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la confirmación.");
    } finally {
      setConfirmationBusyId(null);
    }
  }

  if (isLoading) return <LoadingScreen message="Buscando tus turnos" />;
  if (!isAuthenticated || role !== "client") return <><SiteHeader /><AuthRequired role="client" title="Mis turnos" /></>;

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <section className="w-full rounded-3xl border border-gold/30 bg-card p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-gold">Reservar</p>
              <h1 className="mt-1 font-display text-2xl font-semibold">Mis turnos</h1>
            </div>
            <Link
              to="/reserva"
              className="inline-flex h-10 items-center rounded-md bg-gold px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-gold-soft"
            >
              Nuevo turno
            </Link>
          </div>
          {loadingBookings ? (
            <p className="text-sm text-muted-foreground">Cargando tus turnos…</p>
          ) : !bookings.length ? (
            <p className="text-sm text-muted-foreground">Todavía no hay turnos asociados a esta cuenta.</p>
          ) : (
            <div className="space-y-2">
            {bookings.map((booking) => {
              const professional = professionals.find((item) => item.id === booking.barberId && item.storeCode === booking.storeCode)
                ?? professionals.find((item) => item.id === booking.barberId);
              const serviceNames = booking.serviceIds.map((id) => professional?.services.find((service) => service.id === id)?.name).filter(Boolean).join(", ");
              const appointmentDate = parseISO(`${booking.date}T${booking.time}`);
              const statusLabel = booking.status === "pending-payment" ? "Pago pendiente" : booking.status === "completed" ? "Asistió" : booking.status === "no-show" ? "No asistió" : booking.status === "cancelled" ? "Cancelado" : "Reservado";
              const statusClass = booking.status === "completed" ? "border-emerald-300 text-emerald-400" : booking.status === "cancelled" || booking.status === "no-show" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-gold/40 text-gold";
              return (
                <article key={booking.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-gold/30 bg-card p-4">
                  <div className="flex w-20 shrink-0 flex-col items-center rounded-lg bg-gold/10 px-2 py-2 text-gold">
                    <span className="text-[10px] uppercase tracking-widest">{format(appointmentDate, "EEE", { locale: es })}</span>
                    <span className="font-display text-2xl font-semibold">{format(appointmentDate, "d")}</span>
                    <span className="text-[10px]">{booking.time}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{professional?.name ?? "Profesional"}</div>
                    <div className="truncate text-sm text-muted-foreground">{serviceNames || "Servicio"} · {booking.duration} min</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className={statusClass}>{statusLabel}</Badge>
                      {booking.appointmentConfirmation && <Badge variant="outline" className="border-sky-300 text-sky-300">{booking.appointmentConfirmation === "confirmed" ? "Confirmaste el turno" : "Sin confirmar"}</Badge>}
                    </div>
                  </div>
                  <div className="font-display text-lg font-semibold text-gold">${booking.totalPrice.toLocaleString("es-AR")}</div>
                  <div className="flex flex-wrap gap-2">
                    {booking.status === "confirmed" && booking.appointmentConfirmation !== "confirmed" && (
                      <Button size="sm" disabled={confirmationBusyId !== null} className="bg-gold text-primary-foreground hover:bg-gold-soft disabled:opacity-60" onClick={() => void confirmBooking(booking.id)}>
                        {confirmationBusyId === booking.id ? "Procesando..." : "Confirmar turno"}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        </section>
      </main>
    </div>
  );
}
