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
import logo from "../../logo.png";
import { reportAppError } from "../lib/error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { LoadingScreen } from "@/components/loading-screen";
import { AccountSetup } from "@/components/account-setup";
import { AuthProvider, useAppAuth } from "@/lib/auth";
import { bootstrapCloudData, clearCloudSession, saveAccountRole } from "@/lib/cloud-sync";

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Mi Turno Ya Reservado" },
      {
        name: "description",
        content:
          "Sistema de reservas para rubros profesionales. Elegí rubro, servicio y horario en segundos.",
      },
      { property: "og:title", content: "Mi Turno Ya Reservado" },
      {
        property: "og:description",
        content:
          "Sistema de reservas para rubros profesionales. Elegí rubro, servicio y horario en segundos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Mi Turno Ya Reservado" },
      {
        name: "twitter:description",
        content:
          "Sistema de reservas para rubros profesionales. Elegí rubro, servicio y horario en segundos.",
      },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg?v=6",
      },
      { rel: "apple-touch-icon", type: "image/png", href: `${logo}?v=4` },
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
    <html lang="en">
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
  const roleAssignmentInProgress = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!configured) {
      clearCloudSession();
      setVerifiedRole(null);
      void bootstrapCloudData("guest", async () => undefined)
        .then(() => setReadyFor("guest"))
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : "No se pudieron cargar los datos."),
        );
      return;
    }
    if (!isAuthenticated) {
      clearCloudSession();
      setVerifiedRole(null);
      setError("");
      void bootstrapCloudData("guest", async () => undefined)
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
    setError("");
    void bootstrapCloudData(email, getIdToken)
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
