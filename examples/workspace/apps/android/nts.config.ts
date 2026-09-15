// Android. JVM backend, Android host.
//
// Depends on `notifications` (Java + TS) and `biometrics` (android+ios only),
// so both of that package's constraints are satisfied here and violated in
// `apps/linux`.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    app: app.android({
      entry: "./src/main.ts",
      id: "dev.example.workspace",
      minSdk: 29,
      // Built against the API 36 surface, running back to 29 -- the two
      // numbers Gradle keeps apart as compileSdk and minSdk.
      compileSdk: 36,
      // An APK carries one lib/<abi>/ per ABI. Play splits them; a single
      // arch could not say this.
      arch: ["aarch64", "armv7"],
    }),
  },
});
