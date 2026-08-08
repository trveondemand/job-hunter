import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/job-hunter/",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
