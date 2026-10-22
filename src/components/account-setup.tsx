import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/loading-screen";
import { useAppAuth, type AccountRole } from "@/lib/auth";
import { saveAccountRole } from "@/lib/cloud-sync";

export function AccountSetup({ onComplete }: { onComplete: (role: AccountRole) => void }) {
  const { user } = useAppAuth();
  const [role, setRole] = useState<AccountRole>("client");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveRole() {
    setSaving(true);
    setError("");
    try {
      await saveAccountRole(role);
      onComplete(role);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar tu cuenta en la base de datos.");
    } finally {
      setSaving(false);
    }
  }

  if (saving) return <LoadingScreen message="Guardando tu cuenta en la base de datos" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-dark px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-gold/30 bg-card p-6 shadow-2xl sm:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-gold">Un paso más</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Configurá tu cuenta</h1>
        <p className="mt-2 text-sm text-muted-foreground">{user?.email}. Esta elección se guarda en la base de datos.</p>
        <label className="mt-6 block text-sm text-muted-foreground">
          Tipo de cuenta
          <select className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" value={role} onChange={(event) => setRole(event.target.value as AccountRole)}>
            <option value="client">Cliente</option>
            <option value="admin">Administrador / Profesional</option>
          </select>
        </label>
        {role === "admin" && (
          <p className="mt-4 rounded-lg border border-gold/20 bg-gold/5 p-3 text-sm text-muted-foreground">
            Cualquier cuenta verificada puede elegir este rol. Se creará una tienda propia y aislada, con un código único para compartir con tus clientes; no tendrás acceso a otras tiendas.
          </p>
        )}
        {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <Button className="mt-6 w-full bg-gold text-primary-foreground hover:bg-gold-soft" disabled={saving} onClick={() => void saveRole()}>
          Guardar en la base de datos
        </Button>
      </section>
    </main>
  );
}
