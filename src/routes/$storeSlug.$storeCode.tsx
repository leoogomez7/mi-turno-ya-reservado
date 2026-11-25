import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExternalLink, MapPin, Star } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import {
  getAvailableStores,
  isCloudInitialized,
  loadReservationStore,
  type Store,
} from "@/lib/cloud-sync";
import type { Professional } from "@/lib/professional-store";

export const Route = createFileRoute("/$storeSlug/$storeCode")({
  head: () => ({ meta: [{ title: "Sucursal · Mi Turno Ya Reservado" }] }),
  component: StoreLandingPage,
});

function StoreLandingPage() {
  const { storeSlug, storeCode } = Route.useParams();
  const normalizedCode = storeCode.toUpperCase();
  const [store, setStore] = useState<Store | null>(
    () => getAvailableStores().find((item) => item.code === normalizedCode) ?? null,
  );
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadStore = async () => {
      if (!isCloudInitialized()) return;
      const availableStore = getAvailableStores().find((item) => item.code === normalizedCode);
      if (!availableStore) {
        if (!cancelled) {
          setStore(null);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) setStore(availableStore);
      try {
        const result = await loadReservationStore(normalizedCode);
        if (cancelled) return;
        setStore(result.stores.find((item) => item.code === normalizedCode) ?? availableStore);
        setProfessionals(result.data.professionals);
      } catch {
        if (!cancelled) setProfessionals([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const handleCloudReady = () => void loadStore();
    void loadStore();
    window.addEventListener("mi-turno-ya:cloud-ready", handleCloudReady);
    window.addEventListener("mi-turno-ya:store-changed", handleCloudReady);
    return () => {
      cancelled = true;
      window.removeEventListener("mi-turno-ya:cloud-ready", handleCloudReady);
      window.removeEventListener("mi-turno-ya:store-changed", handleCloudReady);
    };
  }, [normalizedCode]);

  const bookingPath = `/reserva/${encodeURIComponent(storeSlug)}/${encodeURIComponent(normalizedCode)}`;
  const employeeNames = professionals
    .map((professional) => professional.name.trim())
    .filter(Boolean);
  const description = store?.settings.description.trim();
  const address = store?.settings.address.trim();
  const rating = store?.settings.googleRating;

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        {loading ? (
          <div className="rounded-3xl border border-gold/30 bg-card p-8 text-sm text-muted-foreground">
            Cargando información de la sucursal…
          </div>
        ) : !store ? (
          <div className="rounded-3xl border border-gold/30 bg-card p-8 text-center">
            <h1 className="font-display text-2xl font-semibold">No encontramos esta sucursal</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Revisá el enlace o pedile a la sucursal su link actualizado.
            </p>
          </div>
        ) : (
          <section className="overflow-hidden rounded-3xl border border-gold/30 bg-card p-5 sm:p-6">
            {store.settings.coverImage && (
              <img
                src={store.settings.coverImage}
                alt={`Portada de ${store.name}`}
                className="mb-5 h-40 w-full rounded-2xl object-cover sm:h-56"
              />
            )}

            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                {store.logo && (
                  <img
                    src={store.logo}
                    alt={`Logo de ${store.name}`}
                    className="h-20 w-20 shrink-0 rounded-full border border-gold/30 bg-background object-contain p-1"
                  />
                )}
                <div className="min-w-0">
                  <h1 className="font-display text-2xl font-semibold sm:text-3xl">{store.name}</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Código de reserva: <span className="font-semibold text-gold">{store.code}</span>
                  </p>
                  {store.settings.googleMapsUrl && (
                    <a
                      href={store.settings.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-sm text-gold underline-offset-4 hover:underline"
                    >
                      {typeof rating === "number" && (
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <Star className="h-4 w-4 fill-current" /> {rating.toFixed(1)}
                        </span>
                      )}
                      Ver reseñas en Google Maps
                      {store.settings.googleReviewCount > 0 && (
                        <span>({store.settings.googleReviewCount})</span>
                      )}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
              <Button
                asChild
                className="shrink-0 bg-gold text-primary-foreground hover:bg-gold-soft"
              >
                <Link to={bookingPath as never}>Reservar turno</Link>
              </Button>
            </div>

            <div className="mt-6 space-y-5 border-t border-border pt-5">
              {employeeNames.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Equipo
                  </p>
                  <p className="mt-1 font-medium text-foreground">{employeeNames.join(" · ")}</p>
                </div>
              )}
              {address && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Ubicación</p>
                  <p className="mt-1 inline-flex items-start gap-1.5 text-sm text-foreground">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" /> {address}
                  </p>
                </div>
              )}
              {description && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Sobre la sucursal
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground">{description}</p>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
