import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

import { AuthRequired } from "@/components/auth-required";
import { LoadingScreen } from "@/components/loading-screen";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bookingStore, getBarber, type Booking } from "@/lib/booking-store";
import { useAppAuth } from "@/lib/auth";
import { getAvailableSlotsForDate, getProfessionalService, professionalStore } from "@/lib/professional-store";

export function AgendaManager() {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [editMode, setEditMode] = useState<"attendance" | "turno" | null>(null);
  const [editedDate, setEditedDate] = useState("");
  const [editedTime, setEditedTime] = useState("");
  const [editedProfessionalId, setEditedProfessionalId] = useState("");
  const [editedServiceId, setEditedServiceId] = useState("");

  useEffect(() => {
    const reload = () => setBookings(bookingStore.all());
    reload();
    window.addEventListener("bookings:changed", reload);
    return () => window.removeEventListener("bookings:changed", reload);
  }, []);

  useEffect(() => {
    if (!selectedBooking) return;
    setEditedDate(selectedBooking.date);
    setEditedTime(selectedBooking.time);
    setEditedProfessionalId(selectedBooking.barberId);
    setEditedServiceId(selectedBooking.serviceIds[0] ?? "");
  }, [selectedBooking]);

  const professionals = professionalStore.all();
  const editedProfessional = professionals.find((professional) => professional.id === editedProfessionalId) ?? professionals[0];
  const availableSlots = useMemo(() => {
    if (!editedProfessional || !editedDate) return [];
    return getAvailableSlotsForDate(editedProfessional, new Date(editedDate));
  }, [editedProfessional, editedDate]);

  if (isLoading) return <LoadingScreen message="Preparando tu agenda" />;
  if (!isAuthenticated || role !== "admin") return <><SiteHeader /><AuthRequired role="admin" title="Agenda" /></>;

  function openDialog(booking: Booking, mode: "attendance" | "turno") {
    setSelectedBooking(booking);
    setEditMode(mode);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setSelectedBooking(null);
    setEditMode(null);
  }

  async function saveBookingEdit() {
    if (!selectedBooking || editMode !== "turno") return;
    const professional = professionalStore.get(editedProfessionalId);
    const service = professional?.services.find((item) => item.id === editedServiceId);
    if (!professional || !service) {
      toast.error("Elegí un profesional y servicio válidos.");
      return;
    }
    try {
      await bookingStore.update(selectedBooking.id, {
        barberId: professional.id,
        serviceIds: [service.id],
        duration: service.duration,
        totalPrice: service.price,
        date: editedDate,
        time: editedTime,
      });
      toast.success("Turno modificado y guardado en la base.");
      closeDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio.");
    }
  }

  async function updateBooking(id: string, patch: Partial<Booking>, success: string) {
    try {
      await bookingStore.update(id, patch);
      toast.success(success);
      closeDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el turno.");
    }
  }

  async function removeBooking(id: string) {
    try {
      await bookingStore.remove(id);
      toast("Turno eliminado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el turno.");
    }
  }

  const visibleBookings = bookings
    .filter((booking) => booking.status !== "cancelled")
    .sort((a, b) => {
      if (!!a.isTest === !!b.isTest) return (a.date + a.time).localeCompare(b.date + b.time);
      return a.isTest ? 1 : -1;
    });

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <section className="w-full rounded-2xl border border-gold/30 bg-card p-4 sm:p-5">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-gold">Control</p>
              <h1 className="font-display text-2xl font-semibold">Agenda</h1>
            </div>
            <Link
              to="/reserva"
              className="inline-flex h-10 items-center rounded-md bg-gold px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-gold-soft"
            >
              Nuevo turno
            </Link>
          </div>
          {!visibleBookings.length ? (
            <p className="text-sm text-muted-foreground">No hay turnos agendados todavía.</p>
          ) : (
            <div className="space-y-2">
              {visibleBookings.map((booking) => {
              const professional = getBarber(booking.barberId);
              const services = booking.serviceIds.map((id) => getProfessionalService(booking.barberId, id)?.name).filter(Boolean).join(", ");
              const date = parseISO(`${booking.date}T${booking.time}`);
              return (
                <div key={booking.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-gold/30 bg-card p-4">
                  <div className="flex w-20 shrink-0 flex-col items-center rounded-lg bg-gold/10 px-2 py-2 text-gold">
                    <span className="text-[10px] uppercase tracking-widest">{format(date, "EEE", { locale: es })}</span>
                    <span className="font-display text-2xl font-semibold">{format(date, "d")}</span>
                    <span className="text-[10px]">{booking.time}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{booking.customer.fullName}</div>
                    <div className="truncate text-sm text-muted-foreground">{services} · {booking.duration} min</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="border-gold/30 text-gold">{professional?.name}</Badge>
                      {booking.isTest && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Turno de prueba</Badge>}
                      {booking.status === "pending-payment" && <Badge variant="outline" className="border-amber-300 text-amber-300">Pago pendiente · {booking.customer.paymentMethod}</Badge>}
                      {booking.status === "completed" && <Badge variant="outline" className="border-emerald-300 text-emerald-400">Asistió</Badge>}
                      {booking.status === "no-show" && <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300">No asistió</Badge>}
                      <span>{booking.customer.phone}</span>
                    </div>
                  </div>
                  <div className="font-display text-lg font-semibold text-gold">${booking.totalPrice.toLocaleString("es-AR")}</div>
                  <div className="flex flex-wrap gap-2">
                    {booking.status === "pending-payment" && <Button size="sm" variant="outline" onClick={() => void updateBooking(booking.id, { status: "confirmed" }, "Pago verificado")}>Confirmar pago</Button>}
                    {booking.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => openDialog(booking, "attendance")}>Indicar asistencia</Button>}
                    <Button size="sm" variant="outline" onClick={() => openDialog(booking, "turno")}>Modificar turno</Button>
                    <Button size="sm" variant="destructive" disabled={booking.isTest} onClick={() => void removeBooking(booking.id)}>Borrar turno</Button>
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </section>

        <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeDialog()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editMode === "attendance" ? "Asistencia" : "Modificar turno"}</DialogTitle>
              <DialogDescription>{editMode === "attendance" ? "Seleccioná si el cliente asistió al turno." : "Modificá profesional, servicio y horario."}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {editMode === "attendance" && <div className="grid gap-3 sm:grid-cols-2"><Button className="bg-emerald-500 text-white" onClick={() => selectedBooking && void updateBooking(selectedBooking.id, { status: "completed" }, "Asistencia registrada")}>Sí asistió</Button><Button className="border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20" onClick={() => selectedBooking && void updateBooking(selectedBooking.id, { status: "no-show" }, "Turno indicado como no asistió")}>No asistió</Button></div>}
              {editMode === "turno" && (
                <div className="grid gap-4">
                  <label className="block text-sm text-muted-foreground">Profesional<select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedProfessionalId} onChange={(event) => { setEditedProfessionalId(event.target.value); setEditedServiceId(professionals.find((item) => item.id === event.target.value)?.services[0]?.id ?? ""); }}>
                    {professionals.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.specialty}</option>)}
                  </select></label>
                  <label className="block text-sm text-muted-foreground">Servicio<select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedServiceId} onChange={(event) => setEditedServiceId(event.target.value)}>
                    {(editedProfessional?.services ?? []).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </select></label>
                  <label className="block text-sm text-muted-foreground">Fecha<input type="date" className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedDate} onChange={(event) => setEditedDate(event.target.value)} /></label>
                  <label className="block text-sm text-muted-foreground">Hora<select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={editedTime} onChange={(event) => setEditedTime(event.target.value)}>
                    <option value="">Seleccionar hora</option>{availableSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                  </select></label>
                </div>
              )}
            </div>
            {editMode === "turno" && <DialogFooter><Button className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void saveBookingEdit()}>Guardar cambios</Button><Button variant="outline" onClick={closeDialog}>Cancelar</Button></DialogFooter>}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
