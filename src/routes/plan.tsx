import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, Check, CreditCard } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { AuthRequired } from "@/components/auth-required";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/loading-screen";
import { useAppAuth } from "@/lib/auth";
import { bootstrapCloudData, createSubscriptionCheckout, getAvailableStores, getCurrentStoreCode, redeemSubscriptionPromo, verifySubscriptionPayment, type Store } from "@/lib/cloud-sync";
import { toast } from "sonner";

export const Route = createFileRoute("/plan")({
  head: () => ({ meta: [{ title: "Plan" }] }),
  component: PlanPage,
});

const SUBSCRIPTION_PLANS = [
  { id: "15d", label: "15 días", amount: 5999 },
  { id: "1m", label: "1 mes", amount: 9999 },
  { id: "2m", label: "2 meses", amount: 14999 },
  { id: "3m", label: "3 meses", amount: 19999 },
  { id: "4m", label: "4 meses", amount: 25999 },
  { id: "6m", label: "6 meses", amount: 36999 },
] as const;

function PlanPage() {
  const { isAuthenticated, isLoading, role, getIdToken, user } = useAppAuth();
  const location = useLocation();
  const [storeInfo, setStoreInfo] = useState<Store | undefined>(() => getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
  const [selectedPlanId, setSelectedPlanId] = useState<string>("15d");
  const [promoCode, setPromoCode] = useState("");
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState("");
  const [pendingPurchaseId, setPendingPurchaseId] = useState("");

  useEffect(() => {
    const update = () => setStoreInfo(getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
    update();
    window.addEventListener("mi-turno-ya:cloud-ready", update);
    window.addEventListener("mi-turno-ya:store-changed", update);
    return () => {
      window.removeEventListener("mi-turno-ya:cloud-ready", update);
      window.removeEventListener("mi-turno-ya:store-changed", update);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.searchStr);
    const status = params.get("subscription_payment");
    const purchaseId = params.get("purchase_id");
    if (!status || !purchaseId) return;
    let cancelled = false;
    setPendingPurchaseId(purchaseId);
    setSubscriptionBusy(true);
    if (status !== "success") {
      setPaymentNotice(status === "pending" ? "El pago está pendiente. La sucursal se activará cuando Mercado Pago lo apruebe." : "El pago no se completó. La sucursal sigue sin activar.");
      setSubscriptionBusy(false);
      return;
    }
    void verifySubscriptionPayment(purchaseId)
      .then(async (result) => {
        if (cancelled) return;
        if (!result.approved) {
          setPaymentNotice("Mercado Pago todavía no confirmó el pago. Podés comprobarlo nuevamente en unos instantes.");
          return;
        }
        await bootstrapCloudData(user?.email ?? "", getIdToken);
        if (cancelled) return;
        setPendingPurchaseId("");
        setStoreInfo(getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
        setPaymentNotice("Pago aprobado. Tu plan está activo.");
        toast.success("Pago aprobado; el sistema de turnos quedó activo.");
      })
      .catch((error: unknown) => {
        if (!cancelled) setPaymentNotice(error instanceof Error ? error.message : "No se pudo verificar el pago.");
      })
      .finally(() => { if (!cancelled) setSubscriptionBusy(false); });
    return () => { cancelled = true; };
  }, [getIdToken, location.searchStr, user?.email]);

  const subscriptionIsActive = Boolean(storeInfo?.subscriptionExpiresAt && Date.parse(storeInfo.subscriptionExpiresAt) > currentTime);
  const subscriptionDaysRemaining = storeInfo?.subscriptionExpiresAt
    ? Math.ceil((Date.parse(storeInfo.subscriptionExpiresAt) - currentTime) / 86_400_000)
    : null;
  const selectedPlan = SUBSCRIPTION_PLANS.find((plan) => plan.id === selectedPlanId) ?? SUBSCRIPTION_PLANS[0];

  if (isLoading) return <LoadingScreen message="Preparando tu plan" />;
  if (!isAuthenticated || role !== "admin") return <><SiteHeader /><AuthRequired role="admin" title="Plan" /></>;

  async function startSubscriptionCheckout() {
    setSubscriptionBusy(true);
    setPaymentNotice("");
    try {
      const checkout = await createSubscriptionCheckout(selectedPlanId);
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      setPaymentNotice(error instanceof Error ? error.message : "No se pudo iniciar el pago del plan.");
      setSubscriptionBusy(false);
    }
  }

  async function applyPromoCode() {
    setSubscriptionBusy(true);
    setPaymentNotice("");
    try {
      const result = await redeemSubscriptionPromo(promoCode, selectedPlanId);
      await bootstrapCloudData(user?.email ?? "", getIdToken);
      setStoreInfo(getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
      setPromoCode("");
      setPaymentNotice(`Cupón aplicado: ${result.planLabel} gratis, hasta ${format(new Date(result.expiresAt), "d 'de' MMMM yyyy", { locale: es })}.`);
      toast.success("Cupón aplicado y plan activado.");
    } catch (error) {
      setPaymentNotice(error instanceof Error ? error.message : "No se pudo aplicar el cupón.");
    } finally {
      setSubscriptionBusy(false);
    }
  }

  async function retrySubscriptionVerification() {
    if (!pendingPurchaseId) return;
    setSubscriptionBusy(true);
    try {
      const result = await verifySubscriptionPayment(pendingPurchaseId);
      if (!result.approved) {
        setPaymentNotice("Mercado Pago todavía no confirmó el pago. Esperá un momento e intentá verificar otra vez.");
        return;
      }
      await bootstrapCloudData(user?.email ?? "", getIdToken);
      setStoreInfo(getAvailableStores().find((store) => store.code === getCurrentStoreCode()));
      setPendingPurchaseId("");
      setPaymentNotice("Pago aprobado. Tu plan está activo.");
      toast.success("Pago aprobado; el sistema de turnos quedó activo.");
    } catch (error) {
      setPaymentNotice(error instanceof Error ? error.message : "No se pudo verificar el pago.");
    } finally {
      setSubscriptionBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-8 rounded-3xl border border-gold/30 bg-card p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-2xl font-semibold">
                {subscriptionIsActive ? (
                  <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-emerald-300 shadow-sm shadow-emerald-500/10">
                    <Check aria-hidden="true" className="h-5 w-5" />
                    Plan activo
                  </span>
                ) : "Plan inactivo"}
                {subscriptionIsActive && subscriptionDaysRemaining !== null && subscriptionDaysRemaining > 0 && subscriptionDaysRemaining <= 4 && (
                  <span role="status" className="inline-flex items-center gap-1.5 font-sans text-sm font-semibold text-red-400">
                    <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                    Plan por vencer
                  </span>
                )}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {subscriptionIsActive && storeInfo?.subscriptionExpiresAt
                  ? `Activo hasta ${format(new Date(storeInfo.subscriptionExpiresAt), "d 'de' MMMM yyyy", { locale: es })}.`
                  : "La sucursal no aparece en las búsquedas y no acepta reservas hasta activar un plan."}
              </p>
              {storeInfo?.subscriptionPlanType === "trial" && subscriptionIsActive && (
                <p className="mt-2 text-sm font-medium text-gold">Estás usando tu prueba gratuita de 4 días. Compra un plan antes de que termine tu prueba gratuita.</p>
              )}
              {storeInfo?.subscriptionExpiresAt && subscriptionDaysRemaining !== null && subscriptionDaysRemaining > 0 && subscriptionDaysRemaining <= 4 && (
                <p role="alert" className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                  Tu plan vence {subscriptionDaysRemaining === 1 ? "dentro de 1 día" : `dentro de ${subscriptionDaysRemaining} días`}. Recordá elegir y pagar un plan manualmente para mantener activa la sucursal.
                </p>
              )}
              {storeInfo?.subscriptionExpiresAt && subscriptionDaysRemaining !== null && subscriptionDaysRemaining <= 0 && (
                <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  Tu plan venció el {format(new Date(storeInfo.subscriptionExpiresAt), "d 'de' MMMM yyyy", { locale: es })}. La sucursal dejó de aparecer en las búsquedas y no puede recibir reservas hasta que pagues un nuevo plan.
                </p>
              )}
            </div>
            <CreditCard className="h-7 w-7 text-gold" />
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SUBSCRIPTION_PLANS.map((plan) => (
              <button key={plan.id} type="button" onClick={() => setSelectedPlanId(plan.id)} className={`rounded-xl border p-3 text-left transition ${selectedPlanId === plan.id ? "border-gold bg-gold/10" : "border-border bg-background hover:border-gold/50"}`}>
                <span className="block font-semibold">{plan.label}</span>
                <span className="text-sm text-muted-foreground">${plan.amount.toLocaleString("es-AR")}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Button disabled={subscriptionBusy} onClick={() => void startSubscriptionCheckout()} className="h-10 whitespace-nowrap bg-gold text-primary-foreground hover:bg-gold-soft">
              {subscriptionBusy ? "Procesando…" : `Pagar $${selectedPlan.amount.toLocaleString("es-AR")} con Mercado Pago`}
            </Button>
            <input className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-44" value={promoCode} onChange={(event) => setPromoCode(event.target.value.toUpperCase())} placeholder="Código promocional" aria-label="Código promocional" />
            <Button type="button" variant="outline" disabled={subscriptionBusy || !promoCode.trim()} onClick={() => void applyPromoCode()} className="h-10 whitespace-nowrap">
              Aplicar cupón (100% OFF)
            </Button>
          </div>
          {paymentNotice && (
            <div role="status" className="mt-3 rounded-lg border border-border bg-background p-3 text-sm">
              <p>{paymentNotice}</p>
              {pendingPurchaseId && <Button type="button" variant="outline" size="sm" className="mt-2" disabled={subscriptionBusy} onClick={() => void retrySubscriptionVerification()}>Verificar pago</Button>}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}