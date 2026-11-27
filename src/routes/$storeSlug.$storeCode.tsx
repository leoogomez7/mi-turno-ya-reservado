import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExternalLink, Instagram, Star } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/loading-screen";
import {
  getCachedReservationStore,
  getAvailableStores,
  getCloudRecords,
  getCurrentStoreCode,
  isCloudInitialized,
  loadReservationStore,
  type Store,
} from "@/lib/cloud-sync";
import type { Professional } from "@/lib/professional-store";
import { normalizeWhatsappNumber } from "@/lib/utils";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12.04 2a9.86 9.86 0 0 0-8.48 14.89L2 22l5.28-1.38A9.93 9.93 0 1 0 12.04 2Zm0 18.02a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.13.82.84-3.05-.2-.32a8.08 8.08 0 1 1 6.92 3.86Zm4.44-6.06c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.93-1.18-.71-.63-1.19-1.41-1.33-1.65-.14-.24-.02-.37.1-.49.1-.1.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.4h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.51.58.18 1.11.16 1.53.1.47-.07 1.43-.58 1.63-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  );
}

export const Route = createFileRoute("/$storeSlug/$storeCode")({
  head: ({ match }) => {
    const { storeSlug, storeCode } = match.params;
    const storeName = storeSlug
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toLocaleUpperCase("es-AR") + part.slice(1))
      .join(" ");
    const title = `${storeName} | Reservá tu turno online`;
    const description = `Consultá servicios y profesionales de ${storeName}, y reservá tu turno online en Mi Turno Ya Reservado.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
      links: [
        {
          rel: "canonical",
          href: `/${encodeURIComponent(storeSlug)}/${encodeURIComponent(storeCode)}`,
        },
      ],
    };
  },
  component: StoreLandingPage,
});

function StoreLandingPage() {
  const { storeSlug, storeCode } = Route.useParams();
  const normalizedCode = storeCode.toUpperCase();
  const cachedBranch = getCachedReservationStore(normalizedCode);
  const hasMatchingCloudSnapshot = getCurrentStoreCode() === normalizedCode;
  const [store, setStore] = useState<Store | null>(
    () =>
      cachedBranch?.stores.find((item) => item.code === normalizedCode) ??
      getAvailableStores().find((item) => item.code === normalizedCode) ??
      null,
  );
  const [professionals, setProfessionals] = useState<Professional[]>(
    () =>
      cachedBranch?.data.professionals ??
      (hasMatchingCloudSnapshot ? getCloudRecords("professionals") : []),
  );
  const [loading, setLoading] = useState(!cachedBranch && !hasMatchingCloudSnapshot);

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
      if (getCurrentStoreCode() === normalizedCode) {
        if (!cancelled) {
          setProfessionals(getCloudRecords("professionals"));
          setLoading(false);
        }
        return;
      }
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
  const instagramUrl = store?.settings.instagram.trim()
    ? `https://www.instagram.com/${store.settings.instagram.trim().replace(/^@/, "")}/`
    : "";
  const whatsappNumber = store?.settings.whatsapp
    ? normalizeWhatsappNumber(store.settings.whatsapp)
    : "";

  useEffect(() => {
    if (store) document.title = `${store.name} | Reservá tu turno online`;
  }, [store?.name]);

  if (loading) return <LoadingScreen message="Sincronizando turnos y profesionales" />;

  return (
    <div className="min-h-screen bg-gradient-dark">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:py-4">
        {!store ? (
          <div className="rounded-3xl border border-gold/30 bg-card p-8 text-center">
            <h1 className="font-display text-2xl font-semibold">No encontramos esta sucursal</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Revisá el enlace o pedile a la sucursal su link actualizado.
            </p>
          </div>
        ) : (
          <section className="overflow-hidden rounded-3xl border border-gold/30 bg-card p-4 sm:p-5 lg:p-5">
            {store.settings.coverImage && (
              <img
                src={store.settings.coverImage}
                alt={`Portada de ${store.name}`}
                className="mb-4 aspect-240/43 w-full rounded-2xl object-cover"
              />
            )}

            <div className="grid gap-8 sm:grid-cols-2">
              <div className="min-w-0">
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
                        className="mt-2 flex w-fit items-center gap-1.5 text-sm text-gold underline-offset-4 hover:underline"
                      >
                        {typeof rating === "number" && (
                          <span className="inline-flex items-center gap-1 font-semibold">
                            <Star className="h-4 w-4 fill-current" /> {rating.toFixed(1)}
                          </span>
                        )}
                        Ver ubicación
                        {store.settings.googleReviewCount > 0 && (
                          <span>({store.settings.googleReviewCount})</span>
                        )}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {store.settings.googleReviewUrl && (
                      <a
                        href={store.settings.googleReviewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 flex w-fit items-center gap-1.5 text-sm text-gold underline-offset-4 hover:underline"
                      >
                        Escribir una reseña
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <Button
                      asChild
                      className="mt-3 w-fit bg-gold text-primary-foreground hover:bg-gold-soft"
                    >
                      <Link to={bookingPath as never}>Reservar turno</Link>
                    </Button>
                  </div>
                  {(instagramUrl || whatsappNumber) && (
                    <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
                      {instagramUrl && (
                        <a
                          href={instagramUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Instagram de ${store.name}`}
                          title="Instagram"
                          className="text-gold transition-colors hover:text-gold-soft"
                        >
                          <Instagram className="h-6 w-6" />
                        </a>
                      )}
                      {whatsappNumber && (
                        <a
                          href={`https://wa.me/${whatsappNumber}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`WhatsApp de ${store.name}`}
                          title="WhatsApp"
                          className="text-gold transition-colors hover:text-gold-soft"
                        >
                          <WhatsAppIcon className="h-6 w-6" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5 border-t border-border pt-5 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0">
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
                  <p className="mt-1 text-sm text-foreground">{address}</p>
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
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
