import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KindeProvider, useKindeAuth } from "@kinde-oss/kinde-auth-react";
import { AUTH_CONFIG, AUTH_CONFIGURED } from "@/lib/env";
import { AuthContext, unavailableAuth } from "@/lib/auth-context";
import type { AccountRole, AuthContextValue } from "@/lib/auth-context";

export type { AccountRole } from "@/lib/auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!AUTH_CONFIGURED)
    return <AuthContext.Provider value={unavailableAuth}>{children}</AuthContext.Provider>;

  const appOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const cleanedDomain = AUTH_CONFIG.domain.replace(/\/+$/, "");
  const domain = /^https?:\/\//i.test(cleanedDomain) ? cleanedDomain : `https://${cleanedDomain}`;

  return (
    <KindeProvider
      clientId={AUTH_CONFIG.clientId}
      domain={domain}
      redirectUri={appOrigin}
      logoutUri={`${appOrigin}/`}
    >
      <KindeSession>{children}</KindeSession>
    </KindeProvider>
  );
}

function KindeSession({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user, login, register, logout, getIdToken } = useKindeAuth();
  const getIdTokenRef = useRef(getIdToken);
  getIdTokenRef.current = getIdToken;
  const getIdTokenStable = useCallback(() => getIdTokenRef.current(), []);
  const [role, setRole] = useState<AccountRole | null>(null);
  const setVerifiedRole = useCallback(
    (verifiedRole: AccountRole | null) => setRole(verifiedRole),
    [],
  );

  useEffect(() => {
    setRole(null);
  }, [isAuthenticated, user?.id]);

  const value = useMemo<AuthContextValue>(() => {
    const startAuth = async (
      action: typeof login | typeof register,
      _requestedRole: AccountRole,
      email?: string,
    ) => {
      try {
        await action({
          ...(AUTH_CONFIG.orgCode ? { orgCode: AUTH_CONFIG.orgCode } : {}),
          ...(AUTH_CONFIG.emailConnectionId ? { connectionId: AUTH_CONFIG.emailConnectionId } : {}),
          ...(email?.trim() ? { loginHint: email.trim() } : {}),
        });
      } catch (error) {
        console.error("No se pudo iniciar la autenticación de Kinde", error);
        window.alert(
          "Kinde no pudo iniciar. Verificá el dominio, Client ID y las URLs autorizadas.",
        );
      }
    };

    return {
      configured: true,
      isAuthenticated,
      isLoading,
      user: user ?? null,
      role,
      setVerifiedRole,
      getIdToken: getIdTokenStable,
      login: (_requestedRole = "client", email) => startAuth(login, "client", email),
      register: (_requestedRole = "client", email) => startAuth(register, "client", email),
      logout: async () => {
        setRole(null);
        await logout({ redirectUrl: `${window.location.origin}/` });
      },
    };
  }, [
    getIdTokenStable,
    isAuthenticated,
    isLoading,
    login,
    logout,
    register,
    role,
    setVerifiedRole,
    user,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
