function readPublicEnv(...keys: string[]) {
  for (const key of keys) {
    const value = import.meta.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export const AUTH_CONFIG = {
  domain: readPublicEnv("VITE_DOMAIN_USER", "DOMAIN_USER"),
  clientId: readPublicEnv("VITE_AUTH_USER", "AUTH_USER"),
  orgCode: readPublicEnv("VITE_ORG_CODE", "ORG_CODE"),
  emailConnectionId: readPublicEnv("VITE_AUTH_CONNECTION_ID", "AUTH_CONNECTION_ID"),
};

export const AUTH_CONFIGURED = Boolean(AUTH_CONFIG.domain && AUTH_CONFIG.clientId);