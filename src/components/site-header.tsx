import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Menu, X } from "lucide-react";
import logo from "../../logo.png";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AUTH_CONFIGURED } from "@/lib/env";
import { rememberAuthReturnPath, rememberSignupRole, useAppAuth, type AccountRole } from "@/lib/auth";
import { useLocation } from "@tanstack/react-router";
import { getAvailableStores, getCurrentStoreCode } from "@/lib/cloud-sync";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NotificationsCenter } from "@/components/notifications-center";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

function preloadStatsCharts() {
  void import("@/components/admin-charts");
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [registrationDialogOpen, setRegistrationDialogOpen] = useState(false);
  const { isAuthenticated, user, role, login, register, logout } = useAppAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [branchInfo, setBranchInfo] = useState(() => ({
    name: getAvailableStores().find((store) => store.code === getCurrentStoreCode())?.name ?? "Cargando...",
    code: getCurrentStoreCode(),
  }));

  useEffect(() => {
    const updateBranchInfo = () => {
      const code = getCurrentStoreCode();
      const store = getAvailableStores().find((item) => item.code === code);
      setBranchInfo({ name: store?.name ?? "Sin nombre", code });
    };
    updateBranchInfo();
    window.addEventListener("mi-turno-ya:cloud-ready", updateBranchInfo);
    window.addEventListener("mi-turno-ya:store-changed", updateBranchInfo);
    return () => {
      window.removeEventListener("mi-turno-ya:cloud-ready", updateBranchInfo);
      window.removeEventListener("mi-turno-ya:store-changed", updateBranchInfo);
    };
  }, []);

  async function startLogin() {
    rememberAuthReturnPath(location.pathname);
    await login();
  }

  async function startRegistration(accountRole: AccountRole) {
    rememberSignupRole(accountRole);
    setRegistrationDialogOpen(false);
    await register(accountRole);
  }

  async function handleLogout() {
    setOpen(false);
    await logout();
    await navigate({ to: "/reserva", replace: true });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="relative flex w-full flex-nowrap items-center justify-between gap-1 px-2 py-2.5 md:gap-2 md:px-4 lg:px-5">
        <Link to="/reserva" className="flex min-w-0 items-center gap-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gold/50 bg-black shadow-[0_0_18px_rgba(234,179,8,0.18)] md:h-12 md:w-12">
            <img src={logo} alt="Mi Turno Ya Reservado" className="h-full w-full object-cover object-center" />
          </span>
          <span className="max-w-[34vw] truncate font-display text-sm font-semibold tracking-tight sm:max-w-none sm:text-lg">Mi Turno Ya Reservado</span>
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <nav className="hidden items-center justify-end gap-1 text-sm md:flex">
          {role === "admin" && (
            <div className="mr-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-lg border border-gold/30 bg-background/50 px-3 py-1.5 text-xs leading-4">
              <span className="text-muted-foreground">Sucursal</span>
              <span className="truncate font-semibold text-gold" title={branchInfo.name}>{branchInfo.name}</span>
              <span className="text-muted-foreground">Código</span>
              <span className="font-semibold text-gold">{branchInfo.code || "—"}</span>
            </div>
          )}
          <Link to="/reserva" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-gold">Reservar</Link>
          {role === "admin" && <Link to="/agenda" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-gold">Agenda</Link>}
          {role === "admin" && <Link to="/estadisticas" preload="intent" onPointerEnter={preloadStatsCharts} onFocus={preloadStatsCharts} className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-gold">Estadísticas</Link>}
          {role === "admin" && <Link to="/plan" preload="intent" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-gold">Plan</Link>}
          {role === "admin" && <Link to="/configuracion" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-gold">Configuración</Link>}
          {isAuthenticated && role === "client" && <Link to="/mis-turnos" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-gold">Mis turnos</Link>}
          {isAuthenticated && role === "client" && <Link to="/mis-datos" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-gold">Mis datos</Link>}
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="max-w-48 truncate border-gold/30">{user?.email || "Cuenta"}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-0 p-1">
                <DropdownMenuItem onSelect={() => void handleLogout()} className="justify-center whitespace-nowrap px-3 py-1.5 text-center font-medium">
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button type="button" className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground" onClick={() => setAuthDialogOpen(true)}>Ingresar</button>
          )}
        </nav>

        <NotificationsCenter isAuthenticated={isAuthenticated} role={role} />

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={open}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/90 p-0 text-foreground shadow-sm transition hover:bg-background md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {isAuthenticated && <button
          type="button"
          onClick={() => void handleLogout()}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-sm transition hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300 md:hidden"
        >
          <LogOut className="h-5 w-5" />
        </button>}
        </div>

        <SheetContent side="right" className="w-[min(88vw,22rem)] border-l border-gold/20 bg-background p-0 text-foreground md:hidden">
          <div className="flex h-full flex-col overflow-y-auto p-5 pt-12">
            <SheetHeader className="border-b border-border pb-5 text-left">
              <SheetTitle className="font-display text-xl">Mi Turno Ya Reservado</SheetTitle>
              <SheetDescription>{isAuthenticated ? user?.email ?? "Tu cuenta" : "Menú de navegación"}</SheetDescription>
            </SheetHeader>
            <nav aria-label="Navegación principal" className="flex flex-col gap-2 py-5 text-sm">
              {role === "admin" && (
                <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-2xl border border-gold/30 bg-gold/5 px-4 py-3 text-xs leading-5">
                  <span className="text-muted-foreground">Sucursal</span>
                  <span className="truncate font-semibold text-gold" title={branchInfo.name}>{branchInfo.name}</span>
                  <span className="text-muted-foreground">Código</span>
                  <span className="font-semibold text-gold">{branchInfo.code || "—"}</span>
                </div>
              )}
              <Link
                to="/reserva"
                onClick={() => setOpen(false)}
                className="block rounded-xl border border-transparent px-4 py-3 text-foreground transition-colors hover:border-border hover:bg-card [&.active]:border-gold/30 [&.active]:bg-gold/10 [&.active]:text-gold"
              >
                Reservar
              </Link>
              {role === "admin" && <Link to="/agenda" onClick={() => setOpen(false)} className="block rounded-xl border border-transparent px-4 py-3 text-foreground transition-colors hover:border-border hover:bg-card [&.active]:border-gold/30 [&.active]:bg-gold/10 [&.active]:text-gold">Agenda</Link>}
              {role === "admin" && <Link to="/estadisticas" preload="intent" onPointerEnter={preloadStatsCharts} onFocus={preloadStatsCharts} onClick={() => setOpen(false)} className="block rounded-xl border border-transparent px-4 py-3 text-foreground transition-colors hover:border-border hover:bg-card [&.active]:border-gold/30 [&.active]:bg-gold/10 [&.active]:text-gold">Estadísticas</Link>}
              {role === "admin" && <Link to="/plan" preload="intent" onClick={() => setOpen(false)} className="block rounded-xl border border-transparent px-4 py-3 text-foreground transition-colors hover:border-border hover:bg-card [&.active]:border-gold/30 [&.active]:bg-gold/10 [&.active]:text-gold">Plan</Link>}
              {role === "admin" && <Link to="/configuracion" onClick={() => setOpen(false)} className="block rounded-xl border border-transparent px-4 py-3 text-foreground transition-colors hover:border-border hover:bg-card [&.active]:border-gold/30 [&.active]:bg-gold/10 [&.active]:text-gold">Configuración</Link>}
              {isAuthenticated && role === "client" && (
                <Link to="/mis-turnos" onClick={() => setOpen(false)} className="block rounded-xl border border-transparent px-4 py-3 text-foreground transition-colors hover:border-border hover:bg-card [&.active]:border-gold/30 [&.active]:bg-gold/10 [&.active]:text-gold">
                  Mis turnos
                </Link>
              )}
              {isAuthenticated && role === "client" && (
                <Link to="/mis-datos" onClick={() => setOpen(false)} className="block rounded-xl border border-transparent px-4 py-3 text-foreground transition-colors hover:border-border hover:bg-card [&.active]:border-gold/30 [&.active]:bg-gold/10 [&.active]:text-gold">
                  Mis datos
                </Link>
              )}
              {!isAuthenticated && <button type="button" onClick={() => { setOpen(false); setAuthDialogOpen(true); }} className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-left font-medium text-gold transition-colors hover:bg-gold/15">Ingresar / Crear cuenta</button>}
            </nav>
          </div>
        </SheetContent>
      </div>
      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Identificate</DialogTitle>
            <DialogDescription>Se te enviará un código para verificar tu acceso.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row">
            <Button variant="outline" onClick={() => { setAuthDialogOpen(false); setRegistrationDialogOpen(true); }}>
              Crear cuenta
            </Button>
            <Button disabled={!AUTH_CONFIGURED} className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void startLogin()}>
              Iniciar sesión
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={registrationDialogOpen} onOpenChange={setRegistrationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Qué tipo de cuenta querés crear?</DialogTitle>
            <DialogDescription>Elegí tu perfil. Después se verifica tu correo.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Button disabled={!AUTH_CONFIGURED} className="h-auto flex-col items-start whitespace-normal bg-gold px-4 py-3 text-left text-primary-foreground hover:bg-gold-soft" onClick={() => void startRegistration("admin")}>
              <span className="font-semibold">Administrador / Profesional</span>
              <span className="text-sm font-normal opacity-80">Gestioná profesionales, agenda y reservas.</span>
            </Button>
            <Button disabled={!AUTH_CONFIGURED} variant="outline" className="h-auto flex-col items-start whitespace-normal px-4 py-3 text-left" onClick={() => void startRegistration("client")}>
              <span className="font-semibold">Cliente</span>
              <span className="text-sm font-normal text-muted-foreground">Reservá turnos y consultá tus reservas.</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
    </Sheet>
  );
}
