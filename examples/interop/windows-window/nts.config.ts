// A Win32 window from TypeScript, built here and run on the lane's Windows.
import { app, defineConfig, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    window: app({
      kind: "executable",
      entry: "./src/main.ts",
      targets: [target.windows({ arch: "x86_64", backend: "c" })],
    }),
  },
  native: [sources({ dir: "native" })],
});
