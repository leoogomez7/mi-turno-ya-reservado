export const AUTH_CONFIG = {
  domain: import.meta.env.VITE_KINDE_DOMAIN?.trim() ?? "",
  clientId: import.meta.env.VITE_KINDE_CLIENT_ID?.trim() ?? "",
  orgCode: import.meta.env.VITE_KINDE_ORG_CODE?.trim() ?? "",
  emailConnectionId: import.meta.env.VITE_KINDE_CONNECTION_ID?.trim() ?? "",
};

export const AUTH_CONFIGURED = Boolean(AUTH_CONFIG.domain && AUTH_CONFIG.clientId);