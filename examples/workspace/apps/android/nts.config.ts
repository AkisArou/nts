// Android. JVM backend, Android host.
//
// Depends on `notifications` (Java + TS) and `biometrics` (android+ios only),
// so both of that package's constraints are satisfied here and violated in
// `apps/linux`.
import { defineConfig, app, host, memory } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    app: app.android({
      entry: "./src/main.ts",
      id: "dev.example.workspace",
      minSdk: 29,
      runtime: { family: "jvm", memory: memory.hostGC() },
      host: host.android({ fetch: "okhttp", ui: "android-views" }),
    }),
  },
});
