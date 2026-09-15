// Android. JVM backend, Android host.
//
// Depends on `notifications` (Java + TS) and `biometrics` (android+ios only),
// so both of that package's constraints are satisfied here and violated in
// `apps/linux`.
import { defineConfig, app, target, host, memory } from "@native-typescript/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    app: app({
      entry: "./src/main.ts",
      id: "dev.example.workspace",
      target: target.android({ backend: "jvm", minSdk: 29 }),
      runtime: { family: "jvm", memory: memory.hostGC() },
      host: host.android({ scheduler: "looper", fetch: "okhttp", ui: "android-views" }),
    }),
  },
});
