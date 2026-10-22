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

const ROLE_STORAGE_KEY = "mi-turno-ya-account-role";
const unavailableAuth: AuthContextValue = {
  configured: false,
  isAuthenticated: false,
  isLoading: false,
  user: null,
  role: null,
  setVerifiedRole: () => undefined,
  getIdToken: async () => undefined,
  login: () => window.alert("La autenticación todavía no está configurada. Revisá .env.example y configurá Kinde."),
  register: () => window.alert("La autenticación todavía no está configurada. Revisá .env.example y configurá Kinde."),
  logout: () => undefined,
};

const AuthContext = createContext<AuthContextValue>(unavailableAuth);

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
  const setVerifiedRole = useCallback((verifiedRole: AccountRole | null) => {
    setRole(verifiedRole);
    if (user?.id && verifiedRole) {
      localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify({ sub: user.id, role: verifiedRole }));
    } else {
      localStorage.removeItem(ROLE_STORAGE_KEY);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isAuthenticated) {
      setRole(null);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(ROLE_STORAGE_KEY) || "null") as { sub?: string; role?: AccountRole } | null;
      const requestedRole = sessionStorage.getItem("mi-turno-ya-requested-role");
      if (user?.id && (requestedRole === "admin" || requestedRole === "client")) {
        localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify({ sub: user.id, role: requestedRole }));
        setRole(requestedRole);
      } else {
        setRole(saved && saved.sub === user?.id && (saved.role === "admin" || saved.role === "client") ? saved.role : null);
      }
    } catch {
      setRole(null);
    }
  }, [isAuthenticated, user?.id]);

  const value = useMemo<AuthContextValue>(() => {
    const startAuth = async (action: typeof login | typeof register, requestedRole: AccountRole, email?: string, adminCode?: string, storeCode?: string) => {
      sessionStorage.setItem("mi-turno-ya-requested-role", requestedRole);
      if (requestedRole === "admin" && adminCode?.trim()) {
        sessionStorage.setItem("mi-turno-ya-admin-code", adminCode.trim());
      } else {
        sessionStorage.removeItem("mi-turno-ya-admin-code");
      }
      if (storeCode?.trim()) sessionStorage.setItem("mi-turno-ya-requested-store", storeCode.trim().toUpperCase());
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
      login: (requestedRole = "client", email, adminCode, storeCode) => startAuth(login, requestedRole, email, adminCode, storeCode),
      register: (requestedRole, email, adminCode, storeCode) => startAuth(register, requestedRole, email, adminCode, storeCode),
      logout: async () => {
        localStorage.removeItem(ROLE_STORAGE_KEY);
        sessionStorage.removeItem("mi-turno-ya-requested-role");
        sessionStorage.removeItem("mi-turno-ya-admin-code");
        sessionStorage.removeItem("mi-turno-ya-requested-store");
        await logout();
      },
    };
  }, [getIdToken, isAuthenticated, isLoading, login, logout, register, role, setVerifiedRole, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAppAuth() {
  return useContext(AuthContext);
}