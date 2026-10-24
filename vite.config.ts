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
      "import.meta.env.VITE_ORG_CODE": JSON.stringify(env.VITE_ORG_CODE || env.CODE_ORG || env.ORG_CODE || env.VITE_KINDE_ORG_CODE || ""),
      "import.meta.env.VITE_AUTH_CONNECTION_ID": JSON.stringify(env.VITE_AUTH_CONNECTION_ID || env.AUTH_CONNECTION_ID || env.VITE_KINDE_CONNECTION_ID || ""),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("/node_modules/lucide-react/")) return "icons";
            if (id.includes("/node_modules/date-fns/")) return "date-utils";
            if (id.includes("/node_modules/@kinde-oss/kinde-auth-react/")) return "authentication";
          },
        },
      },
    },
    plugins: [
      tanstackStart({ router: { autoCodeSplitting: true } }),
      react(),
      tsconfigPaths(),
      tailwindcss(),
    ],
  };
});
