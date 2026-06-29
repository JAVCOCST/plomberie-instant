import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Multi-page build : on génère index.html ET embauche.html.
  // Les deux montent le même bundle React (main.tsx) ; la seule différence
  // est leur <head> (OG meta tags distincts pour Facebook/Meta Ads).
  // Le rewrite Vercel (vercel.json) sert embauche.html sur /embauche*.
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        embauche: path.resolve(__dirname, "embauche.html"),
      },
    },
  },
}));
