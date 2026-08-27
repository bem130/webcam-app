import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  base: "/webcam-app/",
  plugins: [preact()],
});
