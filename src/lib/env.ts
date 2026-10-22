function firstValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

export const AUTH_CONFIG = {
  domain: firstValue(import.meta.env.VITE_DOMAIN_USER, import.meta.env.VITE_KINDE_DOMAIN),
  clientId: firstValue(import.meta.env.VITE_AUTH_USER, import.meta.env.VITE_KINDE_CLIENT_ID),
  orgCode: firstValue(import.meta.env.VITE_ORG_CODE, import.meta.env.VITE_KINDE_ORG_CODE),
  emailConnectionId: firstValue(import.meta.env.VITE_AUTH_CONNECTION_ID, import.meta.env.VITE_KINDE_CONNECTION_ID),
};

export const AUTH_CONFIGURED = Boolean(AUTH_CONFIG.domain && AUTH_CONFIG.clientId);