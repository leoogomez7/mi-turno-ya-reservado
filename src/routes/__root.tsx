import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportAppError } from "../lib/error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { OverlayScrollbar } from "@/components/overlay-scrollbar";
import { LoadingScreen } from "@/components/loading-screen";
import { AccountSetup } from "@/components/account-setup";
import { AuthProvider } from "@/lib/auth";
import { useAppAuth } from "@/lib/auth-context";
import {
  bootstrapCloudData,
  clearCloudSession,
  isCloudInitialized,
  loadReservationStore,
  refreshCloudData,
  saveAccountRole,
} from "@/lib/cloud-sync";

function getInitialRouteStoreCode() {
  if (typeof window === "undefined") return "";
  const segments = window.location.pathname.split("/").filter(Boolean);
  const storeCode =
    segments[0] === "reserva"
      ? segments.length >= 3
        ? segments[2]
        : ""
      : segments.length === 2
        ? segments[1]
        : "";
  try {
    return decodeURIComponent(storeCode).trim().toUpperCase();
  } catch {
    return storeCode.trim().toUpperCase();
  }
}

async function bootstrapWithInitialRouteStore(
  account: string,
  getToken: () => Promise<string | undefined>,
  storeCode: string,
) {
  if (account === "guest" && storeCode) {
    return bootstrapCloudData(account, getToken, storeCode);
  }
  const branchData = storeCode
    ? loadReservationStore(storeCode, getToken).catch(() => undefined)
    : Promise.resolve(undefined);
  const [role] = await Promise.all([bootstrapCloudData(account, getToken), branchData]);
  return role;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    if (error instanceof Error) {
      reportAppError(error, { boundary: "tanstack_root_error_component" });
    }
  }, [error]);

  useEffect(() => {
    const retryTimer = window.setTimeout(() => {
      void router.invalidate().then(reset, reset);
    }, 1800);
    return () => window.clearTimeout(retryTimer);
  }, [reset, router]);

  return <LoadingScreen message="Estamos preparando todo para vos" />;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "google", content: "notranslate" },
      { title: "Mi Turno Ya Reservado | Turnos online" },
      {
        name: "description",
        content:
          "Encontrá sucursales y profesionales, consultá servicios y reservá tu próximo turno online de forma simple.",
      },
      { property: "og:title", content: "Mi Turno Ya Reservado | Turnos online" },
      {
        property: "og:description",
        content: "Encontrá sucursales y reservá turnos online de forma simple.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Mi Turno Ya Reservado | Turnos online" },
      {
        name: "twitter:description",
        content: "Encontrá sucursales y reservá turnos online de forma simple.",
      },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/logo.png?v=12" },
      { rel: "shortcut icon", type: "image/png", sizes: "512x512", href: "/logo.png?v=12" },
      { rel: "apple-touch-icon", sizes: "512x512", href: "/logo.png?v=12" },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es" translate="no">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CloudDataBootstrap>
          <Outlet />
          <Toaster theme="dark" position="top-center" />
          <OverlayScrollbar />
        </CloudDataBootstrap>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function CloudDataBootstrap({ children }: { children: ReactNode }) {
  const { configured, isAuthenticated, isLoading, user, role, getIdToken, setVerifiedRole } =
    useAppAuth();
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [needsAccountSetup, setNeedsAccountSetup] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [initialRouteStoreCode] = useState(getInitialRouteStoreCode);
  const roleAssignmentInProgress = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!configured) {
      setReadyFor(null);
      clearCloudSession();
      setVerifiedRole(null);
      void bootstrapWithInitialRouteStore("guest", async () => undefined, initialRouteStoreCode)
        .then(() => setReadyFor("guest"))
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : "No se pudieron cargar los datos."),
        );
      return;
    }
    if (!isAuthenticated) {
      setReadyFor(null);
      clearCloudSession();
      setVerifiedRole(null);
      setError("");
      void bootstrapWithInitialRouteStore("guest", async () => undefined, initialRouteStoreCode)
        .then(() => setReadyFor("guest"))
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : "No se pudieron cargar los datos."),
        );
      return;
    }

    const email = user?.email?.trim().toLowerCase();
    if (!email) {
      setError("La sesión Kinde no contiene un correo para cargar tus turnos.");
      return;
    }

    let cancelled = false;
    setReadyFor(null);
    setError("");
    void bootstrapWithInitialRouteStore(email, getIdToken, initialRouteStoreCode)
      .then(async (verifiedRole) => {
        if (cancelled) return;
        const requestedRole = window.sessionStorage.getItem("kinde-signup-role");
        if (
          verifiedRole === "unassigned" &&
          (requestedRole === "admin" || requestedRole === "client")
        ) {
          const assignment =
            roleAssignmentInProgress.current ??
            saveAccountRole(requestedRole).then(() => undefined);
          try {
            await assignment;
            window.sessionStorage.removeItem("kinde-signup-role");
            verifiedRole = requestedRole;
          } finally {
            if (roleAssignmentInProgress.current === assignment) {
              roleAssignmentInProgress.current = null;
            }
          }
        } else {
          window.sessionStorage.removeItem("kinde-signup-role");
        }
        if (cancelled) return;
        setNeedsAccountSetup(verifiedRole === "unassigned");
        setVerifiedRole(
          verifiedRole === "admin" || verifiedRole === "client" ? verifiedRole : null,
        );
        setReadyFor(email);
      })
      .catch((reason: unknown) => {
        console.error("No se pudieron cargar los datos de Turso", reason);
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "No se pudieron cargar tus datos.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [configured, getIdToken, isAuthenticated, isLoading, setVerifiedRole, user?.email, attempt]);

  useEffect(() => {
    const account = isAuthenticated ? (user?.email?.trim().toLowerCase() ?? "") : "guest";
    if (isLoading || !account || readyFor !== account || !isCloudInitialized()) return;

    let active = true;
    let refreshInFlight = false;
    const refresh = () => {
      if (!active || document.hidden || refreshInFlight) return;
      refreshInFlight = true;
      void refreshCloudData()
        .catch(() => undefined)
        .finally(() => {
          refreshInFlight = false;
        });
    };
    const intervalId = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isAuthenticated, isLoading, readyFor, user?.email]);

  const owner = isAuthenticated ? (user?.email?.trim().toLowerCase() ?? "") : "guest";
  const ready = !isLoading && readyFor === owner;
  if (ready && isAuthenticated && needsAccountSetup) {
    return (
      <AccountSetup
        onComplete={(nextRole) => {
          setVerifiedRole(nextRole);
          setNeedsAccountSetup(false);
          setAttempt((value) => value + 1);
        }}
      />
    );
  }
  if (ready) return <>{children}</>;

  return (
    <LoadingScreen
      message={error ? undefined : "Sincronizando turnos y profesionales"}
      error={error || undefined}
      onRetry={error ? () => setAttempt((value) => value + 1) : undefined}
    />
  );
}
