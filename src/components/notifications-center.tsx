import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getNotifications, setNotificationRead, type BookingNotification } from "@/lib/cloud-sync";
import type { AccountRole } from "@/lib/auth";

export function NotificationsCenter({ isAuthenticated, role }: { isAuthenticated: boolean; role: AccountRole | null }) {
  const [notifications, setNotifications] = useState<BookingNotification[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [promptOpen, setPromptOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bellRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated || (role !== "admin" && role !== "client")) {
      setNotifications([]);
      setPromptOpen(false);
      setPanelOpen(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    const refresh = async (showWelcome: boolean) => {
      try {
        const { notifications: loaded, newForPrompt } = await getNotifications();
        if (!active) return;
        setNotifications(loaded);
        if (showWelcome) {
          setNewCount(newForPrompt.length);
          setPromptOpen(newForPrompt.length > 0);
        }
        setError("");
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudieron cargar las notificaciones.");
      } finally {
        if (active && showWelcome) setLoading(false);
      }
    };
    void refresh(true);
    const refreshQuietly = () => { void refresh(false); };
    const intervalId = window.setInterval(refreshQuietly, 30000);
    window.addEventListener("focus", refreshQuietly);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshQuietly);
    };
  }, [isAuthenticated, role]);

  async function toggleRead(notification: BookingNotification) {
    const read = !notification.readAt;
    setNotifications((current) => current.map((item) => item.id === notification.id
      ? { ...item, readAt: read ? new Date().toISOString() : null }
      : item));
    try {
      await setNotificationRead(notification.id, read);
    } catch (reason) {
      setNotifications((current) => current.map((item) => item.id === notification.id
        ? { ...item, readAt: notification.readAt }
        : item));
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar la notificación.");
    }
  }

  async function markAllRead() {
    const unread = notifications.filter((item) => !item.readAt);
    try {
      await Promise.all(unread.map((item) => setNotificationRead(item.id, true)));
      const now = new Date().toISOString();
      setNotifications((current) => current.map((item) => item.readAt ? item : { ...item, readAt: now }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron marcar las notificaciones como vistas.");
    }
  }

  if (!isAuthenticated || (role !== "admin" && role !== "client")) return null;

  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <div className="relative shrink-0">
      <Button
        ref={bellRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Notificaciones${unreadCount ? `, ${unreadCount} sin leer` : ""}`}
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((open) => !open)}
        className="relative h-10 w-10 rounded-full border border-border/60 text-foreground hover:border-gold/50 hover:text-gold"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </Button>

      {panelOpen && (
        <section aria-label="Notificaciones" className="absolute right-0 top-full z-60 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-gold/30 bg-background p-3 text-foreground shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-border pb-2">
            <h2 className="font-semibold">Notificaciones</h2>
            {unreadCount > 0 && <button type="button" className="text-xs text-gold hover:underline" onClick={() => void markAllRead()}>Marcar todas vistas</button>}
          </div>
          {error && <p role="alert" className="mb-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
          {loading ? <p className="py-5 text-center text-sm text-muted-foreground">Cargando…</p>
            : notifications.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">Todavía no tenés notificaciones.</p>
              : <ul className="max-h-[min(65vh,28rem)] space-y-2 overflow-y-auto pr-1">
                {notifications.map((notification) => (
                  <li key={notification.id} className={`rounded-xl border p-3 ${notification.readAt ? "border-border bg-card/60" : "border-gold/40 bg-gold/5"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{notification.title}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{notification.message}</p>
                        <time className="mt-2 block text-[11px] text-muted-foreground" dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString("es-AR")}</time>
                      </div>
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${notification.readAt ? "bg-border" : "bg-gold"}`} aria-label={notification.readAt ? "Vista" : "Sin leer"} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <button type="button" className="inline-flex items-center gap-1 text-xs text-gold hover:underline" onClick={() => {
                        void toggleRead(notification);
                        setPanelOpen(false);
                        void navigate({ to: role === "admin" ? "/agenda" : "/mis-turnos" });
                      }}>
                        Ver turno <ExternalLink className="h-3 w-3" />
                      </button>
                      <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => void toggleRead(notification)}>
                        {notification.readAt ? "Marcar no vista" : <><Check className="h-3 w-3" /> Marcar vista</>}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>}
        </section>
      )}

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevas notificaciones a revisar</DialogTitle>
            <DialogDescription>{newCount === 1 ? "Tenés una novedad sobre un turno." : `Tenés ${newCount} novedades sobre turnos.`} Podés consultarlas ahora o más tarde desde la campanita.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPromptOpen(false)}>Más tarde</Button>
            <Button type="button" className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => {
              setPromptOpen(false);
              setPanelOpen(true);
              window.setTimeout(() => bellRef.current?.focus(), 0);
            }}>Ver notificaciones</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}