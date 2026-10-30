import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AuthRequired } from "@/components/auth-required";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingScreen } from "@/components/loading-screen";
import { useAppAuth } from "@/lib/auth";
import { bookingStore } from "@/lib/booking-store";
import { getClientProfile, saveClientProfile } from "@/lib/cloud-sync";

export const Route = createFileRoute("/mis-datos")({
  head: () => ({ meta: [{ title: "Mis datos" }] }),
  component: MyDataPage,
});

function MyDataPage() {
  const { isAuthenticated, isLoading, role, user } = useAppAuth();
  const [phone, setPhone] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || role !== "client") return;
    let cancelled = false;
    void getClientProfile()
      .then((profile) => {
        if (!cancelled) {
          const accountEmail = user?.email?.trim().toLowerCase();
          const bookingPhone = bookingStore.all().find((booking) => booking.customer.email.trim().toLowerCase() === accountEmail)?.customer.phone;
          setPhone(profile.phone || bookingPhone || "");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "No se pudieron cargar tus datos.");
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, role, user?.email]);

  async function savePhone() {
    const normalizedPhone = phone.trim();
    if (normalizedPhone.length < 6 || normalizedPhone.length > 40) {
      toast.error("El teléfono debe tener entre 6 y 40 caracteres.");
      return;
    }
    setSavingProfile(true);
    try {
      const saved = await saveClientProfile(normalizedPhone);
      setPhone(saved.phone);
      toast.success("Teléfono actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar tus datos.");
    } finally {
      setSavingProfile(false);
    }
  }

  if (isLoading) return <LoadingScreen message="Cargando tus datos" />;
  if (!isAuthenticated || role !== "client") return <><SiteHeader /><AuthRequired role="client" title="Mis datos" /></>;

  const fullName = [user?.givenName, user?.familyName].filter(Boolean).join(" ");

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-xs uppercase tracking-widest text-gold">Cuenta de cliente</p>
        <h1 className="font-display text-4xl font-semibold">Mis datos</h1>
        <section className="mt-8 space-y-5 rounded-2xl border border-gold/30 bg-card p-5 sm:p-7">
          <div>
            <label className="mb-2 block text-sm text-muted-foreground" htmlFor="profile-name">Nombre y apellido</label>
            <Input id="profile-name" value={fullName || "No informado en Kinde"} readOnly />
          </div>
          <div>
            <label className="mb-2 block text-sm text-muted-foreground" htmlFor="profile-email">Correo electrónico</label>
            <Input id="profile-email" type="email" value={user?.email ?? ""} readOnly aria-readonly="true" />
            <p className="mt-1 text-xs text-muted-foreground">El correo asociado a tu cuenta no se puede modificar desde aquí.</p>
          </div>
          <div>
            <label className="mb-2 block text-sm text-muted-foreground" htmlFor="profile-phone">Teléfono</label>
            <Input id="profile-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Tu número de teléfono" disabled={loadingProfile || savingProfile} maxLength={40} />
          </div>
          <div className="flex justify-end">
            <Button className="bg-gold text-primary-foreground hover:bg-gold-soft" onClick={() => void savePhone()} disabled={loadingProfile || savingProfile}>
              {savingProfile ? "Guardando..." : "Guardar teléfono"}
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
