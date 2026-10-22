import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AUTH_CONFIGURED } from "@/lib/env";
import { useAppAuth, type AccountRole } from "@/lib/auth";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [selectedRole, setSelectedRole] = useState<AccountRole>("client");
  const [adminCode, setAdminCode] = useState("");
  const [adminStoreCode, setAdminStoreCode] = useState("");
  const { isAuthenticated, user, role, login, register, logout } = useAppAuth();

  async function startAuth() {
    if (authMode === "register") await register(selectedRole, undefined, adminCode, adminStoreCode);
    else await login(selectedRole, undefined, adminCode, adminStoreCode);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="relative flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 md:px-4 lg:px-5">
        <Link to="/reserva" className="flex items-center gap-2">
          <img src="/logo.png" alt="Mi Turno Ya Reservado" className="h-10 w-10 rounded-full object-cover" />
          <span className="font-display text-lg font-semibold tracking-tight">Mi Turno Ya</span>
        </Link>

        <nav className="hidden items-center justify-end gap-1 text-sm md:flex">
          <Link to="/reserva" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-gold">Reservar</Link>
          {role === "admin" && <Link to="/profesionales" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Profesionales</Link>}
          {role === "admin" && <Link to="/admin" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Administración</Link>}
          {isAuthenticated && role === "client" && <Link to="/mis-turnos" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Mis turnos</Link>}
          {isAuthenticated ? (
            <Button size="sm" variant="outline" onClick={() => void logout()}>{user?.email || "Cerrar sesión"}</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => { setAuthMode("login"); setAuthDialogOpen(true); }}>Ingresar</Button>
          )}
        </nav>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-2 text-sm text-foreground shadow-sm transition hover:bg-background md:hidden"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          <span>Menú</span>
        </button>

        {open && (
          <div className="absolute left-1/2 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-xs -translate-x-1/2 rounded-3xl border border-border/60 bg-black p-3 shadow-2xl md:hidden">
            <nav className="flex flex-col gap-2 text-sm">
              <Link
                to="/reserva"
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-3 text-foreground hover:bg-border/10 [&.active]:bg-gold/10 [&.active]:text-gold"
              >
                Reservar
              </Link>
              {role === "admin" && <Link to="/profesionales" onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-foreground hover:bg-border/10">Profesionales</Link>}
              {role === "admin" && <Link to="/admin" onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-foreground hover:bg-border/10">Administración</Link>}
              {isAuthenticated && role === "client" && (
                <Link to="/mis-turnos" onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-foreground hover:bg-border/10">
                  Mis turnos
                </Link>
              )}
              {isAuthenticated ? (
                <button type="button" onClick={() => { setOpen(false); void logout(); }} className="rounded-2xl px-4 py-3 text-left text-foreground hover:bg-border/10">Cerrar sesión</button>
              ) : (
                <button type="button" onClick={() => { setOpen(false); setAuthMode("login"); setAuthDialogOpen(true); }} className="rounded-2xl px-4 py-3 text-left text-foreground hover:bg-border/10">Ingresar / Crear cuenta</button>
              )}
            </nav>
          </div>
        )}
      </div>
      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{authMode === "register" ? "Crear cuenta" : "Iniciar sesión"}</DialogTitle>
            <DialogDescription>Elegí el tipo de cuenta. Para activar una cuenta administradora se necesita un código de invitación.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <label className="block text-sm text-muted-foreground">
              Tipo de cuenta
              <select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as AccountRole)}>
                <option value="client">Cliente</option>
                <option value="admin">Administrador / Profesional</option>
              </select>
            </label>
            {selectedRole === "admin" && (
              <div className="space-y-3">
                <label className="block text-sm text-muted-foreground">
                  Código de la tienda
                  <input
                    value={adminStoreCode}
                    onChange={(event) => setAdminStoreCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
                    placeholder="Código que identifica tu tienda"
                    maxLength={20}
                    className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  />
                  <span className="mt-2 block text-xs">Este código separa la agenda, profesionales y reservas de tu tienda.</span>
                </label>
                <label className="block text-sm text-muted-foreground">
                  Código de invitación de administrador
                  <input
                    type="password"
                    autoComplete="one-time-code"
                    value={adminCode}
                    onChange={(event) => setAdminCode(event.target.value)}
                    placeholder="Código privado del administrador de la tienda"
                    className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                  />
                  <span className="mt-2 block text-xs">Solicitalo al administrador propietario de esa tienda.</span>
                </label>
              </div>
            )}
            {!AUTH_CONFIGURED && <p className="text-sm text-destructive">Kinde no está configurado. Consultá el archivo .env.example.</p>}
          </div>
          <DialogFooter className="flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setAuthMode(authMode === "register" ? "login" : "register")}>
              {authMode === "register" ? "Ya tengo cuenta" : "Crear cuenta"}
            </Button>
            <Button disabled={!AUTH_CONFIGURED || (selectedRole === "admin" && (!adminCode.trim() || adminStoreCode.trim().length < 3))} className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void startAuth()}>
              {authMode === "register" ? "Continuar con Kinde" : "Iniciar con Kinde"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
