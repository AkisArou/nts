// Android. JVM backend, Android host.
//
// Depends on `notifications` (Java + TS) and `biometrics` (android+ios only),
// so both of that package's constraints are satisfied here and violated in
// `apps/linux`.
import { defineConfig, app, manifest } from "@nts/config";

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
  // The app's own manifest. Both packages contribute a fragment and an APK
  // carries one `AndroidManifest.xml`, so the build refuses to generate one
  // that silently drops them -- see `manifests/android.xml` for what that
  // costs when it happens.
  manifests: [manifest({ targets: ["android-29"], path: "manifests/android.xml" })],
});
