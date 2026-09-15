// Linux. GTK host.
//
// **This app must fail to configure if it depends on `biometrics`**, which
// declares `["android-29", "ios-17"]`. It does not depend on it, and that is
// the point: the failure should be a configuration error naming the package and
// the target, not a missing symbol at link time. No such check exists yet.
import { defineConfig, app, memory } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    app: app.linux({
      entry: "./src/main.ts",
      runtime: { memory: memory.rcCycle() },
    }),
  },
});
