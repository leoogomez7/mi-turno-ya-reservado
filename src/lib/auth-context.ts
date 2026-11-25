import { createContext, useContext } from "react";

export type AccountRole = "admin" | "client";

type AuthUser = {
  id?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
};

export type AuthContextValue = {
  configured: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  role: AccountRole | null;
  setVerifiedRole: (role: AccountRole | null) => void;
  getIdToken: () => Promise<string | undefined>;
  login: (
    role?: AccountRole,
    email?: string,
    adminCode?: string,
    storeCode?: string,
  ) => void | Promise<void>;
  register: (
    role: AccountRole,
    email?: string,
    adminCode?: string,
    storeCode?: string,
  ) => void | Promise<void>;
  logout: () => void | Promise<void>;
};

export const unavailableAuth: AuthContextValue = {
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

export const AuthContext = createContext<AuthContextValue>(unavailableAuth);

export function useAppAuth() {
  return useContext(AuthContext);
}
