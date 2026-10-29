import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { KindeProvider, useKindeAuth } from "@kinde-oss/kinde-auth-react";
import { AUTH_CONFIG, AUTH_CONFIGURED } from "@/lib/env";

export type AccountRole = "admin" | "client";

type AuthUser = {
  id?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
};

type AuthContextValue = {
  configured: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  role: AccountRole | null;
  setVerifiedRole: (role: AccountRole | null) => void;
  getIdToken: () => Promise<string | undefined>;
  login: (role?: AccountRole, email?: string, adminCode?: string, storeCode?: string) => void | Promise<void>;
  register: (role: AccountRole, email?: string, adminCode?: string, storeCode?: string) => void | Promise<void>;
  logout: () => void | Promise<void>;
};

const unavailableAuth: AuthContextValue = {
  configured: false,
  isAuthenticated: false,
  isLoading: false,
  user: null,
  role: null,
  setVerifiedRole: () => undefined,
  getIdToken: async () => undefined,
  login: () => undefined,
  register: () => undefined,
  logout: () => undefined,
};

const AuthContext = createContext<AuthContextValue>(unavailableAuth);

export function rememberAuthReturnPath(path: string) {
  if (typeof window === "undefined") return;
  const allowedPaths = ["/admin", "/agenda", "/estadisticas", "/plan", "/configuracion", "/profesionales", "/mis-turnos", "/reserva"];
  if (allowedPaths.includes(path)) {
    window.sessionStorage.setItem("kinde-auth-return-path", path);
  }
}

export function rememberSignupRole(role: AccountRole) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem("kinde-signup-role", role);
  window.sessionStorage.setItem("kinde-auth-return-path", role === "admin" ? "/configuracion" : "/reserva");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!AUTH_CONFIGURED) return <AuthContext.Provider value={unavailableAuth}>{children}</AuthContext.Provider>;

  const appOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const cleanedDomain = AUTH_CONFIG.domain.replace(/\/+$/, "");
  const domain = /^https?:\/\//i.test(cleanedDomain) ? cleanedDomain : `https://${cleanedDomain}`;

  return (
    <KindeProvider clientId={AUTH_CONFIG.clientId} domain={domain} redirectUri={appOrigin} logoutUri={appOrigin}>
      <KindeSession>{children}</KindeSession>
    </KindeProvider>
  );
}

function KindeSession({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user, login, register, logout, getIdToken } = useKindeAuth();
  const [role, setRole] = useState<AccountRole | null>(null);
  const setVerifiedRole = useCallback((verifiedRole: AccountRole | null) => setRole(verifiedRole), []);

  useEffect(() => {
    setRole(null);
  }, [isAuthenticated, user?.id]);

  const value = useMemo<AuthContextValue>(() => {
    const startAuth = async (action: typeof login | typeof register, _requestedRole: AccountRole, email?: string) => {
      try {
        await action({
          ...(AUTH_CONFIG.orgCode ? { orgCode: AUTH_CONFIG.orgCode } : {}),
          ...(AUTH_CONFIG.emailConnectionId ? { connectionId: AUTH_CONFIG.emailConnectionId } : {}),
          ...(email?.trim() ? { loginHint: email.trim() } : {}),
        });
      } catch (error) {
        console.error("No se pudo iniciar la autenticación de Kinde", error);
        window.alert("Kinde no pudo iniciar. Verificá el dominio, Client ID y las URLs autorizadas.");
      }
    };

    return {
      configured: true,
      isAuthenticated,
      isLoading,
      user: user ?? null,
      role,
      setVerifiedRole,
      getIdToken,
      login: (_requestedRole = "client", email) => startAuth(login, "client", email),
      register: (_requestedRole = "client", email) => startAuth(register, "client", email),
      logout: async () => {
        setRole(null);
        await logout();
      },
    };
  }, [getIdToken, isAuthenticated, isLoading, login, logout, register, role, setVerifiedRole, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAppAuth() {
  return useContext(AuthContext);
}