import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BOOKING_HIGHLIGHT_KEY, deleteNotification, getNotifications, notificationBookingExists, setNotificationRead, type BookingNotification } from "@/lib/cloud-sync";
import type { AccountRole } from "@/lib/auth";

function parseNotificationTimestamp(value: string) {
  const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(timestamp);
}

function formatBuenosAiresTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(parseNotificationTimestamp(value));
}

export function NotificationsCenter({ isAuthenticated, role }: { isAuthenticated: boolean; role: AccountRole | null }) {
  const [notifications, setNotifications] = useState<BookingNotification[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [promptOpen, setPromptOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [markingIds, setMarkingIds] = useState<Set<string>>(() => new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const [checkingBookingIds, setCheckingBookingIds] = useState<Set<string>>(() => new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const checkingBookingIdsRef = useRef(new Set<string>());
  const deletingIdsRef = useRef(new Set<string>());
  const deletedNotificationIdsRef = useRef(new Set<string>());
  const markingIdsRef = useRef(new Set<string>());
  const pendingReadRef = useRef(new Map<string, string>());
  const refreshSequenceRef = useRef(0);
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
      const requestSequence = ++refreshSequenceRef.current;
      try {
        const { notifications: loaded, newForPrompt } = await getNotifications();
        if (!active || requestSequence !== refreshSequenceRef.current) return;
        setNotifications(loaded.filter((notification) => !deletedNotificationIdsRef.current.has(notification.id)).map((notification) => {
          const pendingReadAt = pendingReadRef.current.get(notification.id);
          if (!pendingReadAt) return notification;
          if (notification.readAt) {
            pendingReadRef.current.delete(notification.id);
            return notification;
          }
          return { ...notification, readAt: pendingReadAt };
        }));
        if (showWelcome) {
          setNewCount(newForPrompt.length);
          setPromptOpen(newForPrompt.length > 0);
        }
        setError("");
      } catch (reason) {
        if (active && requestSequence === refreshSequenceRef.current) setError(reason instanceof Error ? reason.message : "No se pudieron cargar las notificaciones.");
      } finally {
        if (active && showWelcome && requestSequence === refreshSequenceRef.current) setLoading(false);
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

  async function markRead(notification: BookingNotification) {
    if (notification.readAt || markingIdsRef.current.has(notification.id)) return;
    const readAt = new Date().toISOString();
    markingIdsRef.current.add(notification.id);
    pendingReadRef.current.set(notification.id, readAt);
    setMarkingIds((current) => new Set(current).add(notification.id));
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item));
    try {
      await setNotificationRead(notification.id, true);
    } catch (reason) {
      pendingReadRef.current.delete(notification.id);
      setNotifications((current) => current.map((item) => item.id === notification.id
        ? { ...item, readAt: notification.readAt }
        : item));
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar la notificación.");
    } finally {
      markingIdsRef.current.delete(notification.id);
      setMarkingIds((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
    }
  }

  async function markAllRead() {
    const unread = notifications.filter((item) => !item.readAt);
    if (!unread.length || markingAll) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    for (const notification of unread) {
      pendingReadRef.current.set(notification.id, now);
      markingIdsRef.current.add(notification.id);
    }
    setMarkingIds((current) => new Set([...current, ...unread.map((item) => item.id)]));
    setNotifications((current) => current.map((item) => item.readAt ? item : { ...item, readAt: now }));
    try {
      const results = await Promise.allSettled(unread.map((item) => setNotificationRead(item.id, true)));
      const failedIds = new Set(results.flatMap((result, index) => result.status === "rejected" ? [unread[index].id] : []));
      if (failedIds.size) {
        for (const id of failedIds) pendingReadRef.current.delete(id);
        setNotifications((current) => current.map((item) => {
          const original = unread.find((notification) => notification.id === item.id);
          return original && failedIds.has(item.id) ? { ...item, readAt: original.readAt } : item;
        }));
        const firstFailure = results.find((result) => result.status === "rejected");
        const reason = firstFailure?.status === "rejected" ? firstFailure.reason : undefined;
        setError(reason instanceof Error ? reason.message : "Algunas notificaciones no se pudieron marcar como leídas.");
      }
    } finally {
      for (const notification of unread) markingIdsRef.current.delete(notification.id);
      setMarkingIds((current) => {
        const next = new Set(current);
        unread.forEach((item) => next.delete(item.id));
        return next;
      });
      setMarkingAll(false);
    }
  }

  async function removeNotification(notification: BookingNotification) {
    if (deletingIdsRef.current.has(notification.id)) return;
    deletingIdsRef.current.add(notification.id);
    deletedNotificationIdsRef.current.add(notification.id);
    setDeletingIds((current) => new Set(current).add(notification.id));
    pendingReadRef.current.delete(notification.id);
    setNotifications((current) => current.filter((item) => item.id !== notification.id));
    try {
      await deleteNotification(notification.id);
    } catch (reason) {
      deletedNotificationIdsRef.current.delete(notification.id);
      setNotifications((current) => [...current, notification].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setError(reason instanceof Error ? reason.message : "No se pudo eliminar la notificación.");
    } finally {
      deletingIdsRef.current.delete(notification.id);
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
    }
  }

  async function viewBooking(notification: BookingNotification) {
    if (checkingBookingIdsRef.current.has(notification.id)) return;
    checkingBookingIdsRef.current.add(notification.id);
    setCheckingBookingIds((current) => new Set(current).add(notification.id));
    try {
      const { exists } = await notificationBookingExists(notification.id);
      if (!exists) {
        toast.error("Este turno ya no está disponible. Es posible que haya sido eliminado.");
        void markRead(notification);
        return;
      }
      sessionStorage.setItem(BOOKING_HIGHLIGHT_KEY, notification.bookingId);
      void markRead(notification);
      setPanelOpen(false);
      await navigate({ to: role === "admin" ? "/agenda" : "/mis-turnos" });
      window.setTimeout(() => window.dispatchEvent(new Event("mi-turno-ya:highlight-booking")), 0);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "No se pudo comprobar si el turno sigue disponible.");
    } finally {
      checkingBookingIdsRef.current.delete(notification.id);
      setCheckingBookingIds((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
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
        onClick={() => {
          const opening = !panelOpen;
          setPanelOpen(opening);
          if (opening) void markAllRead();
        }}
        className="relative h-10 w-10 rounded-full border border-border/60 text-foreground hover:border-gold/50 hover:text-gold"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </Button>

      {panelOpen && (
        <section aria-label="Notificaciones" className="absolute right-0 top-full z-60 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-gold/30 bg-background p-3 text-foreground shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-border pb-2">
            <h2 className="font-semibold">Notificaciones</h2>
            {unreadCount > 0 && <button type="button" disabled={markingAll} className="text-xs text-gold hover:underline disabled:cursor-wait disabled:opacity-70" onClick={() => void markAllRead()}>{markingAll ? "Marcando leídas..." : "Marcar todas leídas"}</button>}
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
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{notification.message.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1")}</p>
                      </div>
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${notification.readAt ? "bg-border" : "bg-gold"}`} aria-label={notification.readAt ? "Leída" : "Sin leer"} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <button type="button" disabled={checkingBookingIds.has(notification.id)} className="inline-flex items-center gap-1 text-xs text-gold hover:underline disabled:cursor-wait disabled:opacity-70" onClick={() => void viewBooking(notification)}>
                        {checkingBookingIds.has(notification.id) ? "Buscando turno..." : <>Ver turno <ExternalLink className="h-3 w-3" /></>}
                      </button>
                      <div className="flex items-center gap-3">
                        {markingIds.has(notification.id)
                          ? <span className="text-xs text-muted-foreground">Marcando leída...</span>
                          : notification.readAt
                          ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3 w-3" /> Leída</span>
                          : <button type="button" disabled={markingAll} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-wait disabled:opacity-70" onClick={() => void markRead(notification)}><Check className="h-3 w-3" /> Marcar como leída</button>}
                        <button type="button" disabled={deletingIds.has(notification.id)} aria-label="Eliminar notificación" title="Eliminar notificación" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-wait disabled:opacity-60" onClick={() => void removeNotification(notification)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
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