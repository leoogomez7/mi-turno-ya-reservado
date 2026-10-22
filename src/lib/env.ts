export const AUTH_CONFIG = {
  domain: import.meta.env.DOMAIN_USER?.trim() ?? "",
  clientId: import.meta.env.AUTH_USER?.trim() ?? "",
  orgCode: import.meta.env.ORG_CODE?.trim() ?? "",
  emailConnectionId: import.meta.env.AUTH_CONNECTION_ID?.trim() ?? "",
};

export const AUTH_CONFIGURED = Boolean(AUTH_CONFIG.domain && AUTH_CONFIG.clientId);