import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import logo from "../../logo.png";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AUTH_CONFIGURED } from "@/lib/env";
import { rememberAuthReturnPath, rememberSignupRole, useAppAuth, type AccountRole } from "@/lib/auth";
import { useLocation } from "@tanstack/react-router";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [registrationDialogOpen, setRegistrationDialogOpen] = useState(false);
  const { isAuthenticated, user, role, login, register, logout } = useAppAuth();
  const location = useLocation();

  async function startLogin() {
    rememberAuthReturnPath(location.pathname);
    await login();
  }

  async function startRegistration(accountRole: AccountRole) {
    rememberSignupRole(accountRole);
    setRegistrationDialogOpen(false);
    await register(accountRole);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="relative flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 md:px-4 lg:px-5">
        <Link to="/reserva" className="flex items-center gap-2">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gold/50 bg-black shadow-[0_0_18px_rgba(234,179,8,0.18)]">
            <img src={logo} alt="Mi Turno Ya Reservado" className="h-full w-full object-cover object-center" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Mi Turno Ya Reservado</span>
        </Link>

        <nav className="hidden items-center justify-end gap-1 text-sm md:flex">
          <Link to="/reserva" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-gold">Reservar</Link>
          {role === "admin" && <Link to="/profesionales" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Profesionales</Link>}
          {role === "admin" && <Link to="/admin" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Administración</Link>}
          {isAuthenticated && role === "client" && <Link to="/mis-turnos" className="px-3 py-2 text-muted-foreground hover:text-foreground [&.active]:text-foreground">Mis turnos</Link>}
          {isAuthenticated ? (
            <Button size="sm" variant="outline" onClick={() => void logout()}>{user?.email || "Cerrar sesión"}</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAuthDialogOpen(true)}>Ingresar</Button>
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
                <button type="button" onClick={() => { setOpen(false); setAuthDialogOpen(true); }} className="rounded-2xl px-4 py-3 text-left text-foreground hover:bg-border/10">Ingresar / Crear cuenta</button>
              )}
            </nav>
          </div>
        )}
      </div>
      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Identificate</DialogTitle>
            <DialogDescription>Iniciá sesión con Kinde. Si usás correo electrónico, Kinde te enviará un código para verificar tu acceso.</DialogDescription>
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
            <DialogDescription>Elegí tu perfil. Después continuarás en Kinde para registrarte y verificar tu correo.</DialogDescription>
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
  );
}
