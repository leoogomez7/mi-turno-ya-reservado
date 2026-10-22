import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    define: {
      "import.meta.env.VITE_DOMAIN_USER": JSON.stringify(env.VITE_DOMAIN_USER || env.DOMAIN_USER || env.VITE_KINDE_DOMAIN || ""),
      "import.meta.env.VITE_AUTH_USER": JSON.stringify(env.VITE_AUTH_USER || env.AUTH_USER || env.VITE_KINDE_CLIENT_ID || ""),
      "import.meta.env.VITE_ORG_CODE": JSON.stringify(env.VITE_ORG_CODE || env.ORG_CODE || env.VITE_KINDE_ORG_CODE || ""),
      "import.meta.env.VITE_AUTH_CONNECTION_ID": JSON.stringify(env.VITE_AUTH_CONNECTION_ID || env.AUTH_CONNECTION_ID || env.VITE_KINDE_CONNECTION_ID || ""),
    },
    plugins: [tanstackStart(), react(), tsconfigPaths(), tailwindcss()],
  };
});
