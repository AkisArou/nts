// Workspace root. Shared settings only -- no products.
//
// **Products live in apps, not here.** One config with every product in it
// reads well for a single project and does not survive a monorepo:
// `apps/android` and `apps/ios` are separately buildable and separately owned,
// and a root file listing both makes every app's build depend on every other
// app's config parsing.
//
// Packages have no products at all, and most have no config: see
// `packages/storage` and `packages/telemetry`.
//
// **`defaults.debug` used to be here and is gone.** It named one of five debug
// profiles that nothing in the compiler emits or reads. The axis
// is real and comes back when something consumes it; until then it was a
// setting whose only effect was to be written down.
import { defineConfig } from "@nts/config";

export default defineConfig({
  workspace: {
    root: ".",
    // Referenced, never restated. tsconfig stays the source of truth for what
    // the program is; this file says what gets built.
    tsconfigBase: "./tsconfig.base.json",
    packages: ["apps/*", "packages/*"],
  },

  build: {
    // Project bindings are cached here, keyed on the resolved config; platform
    // type surfaces are npm dependencies and are not cached because they are
    // not generated.
    cache: { local: true, directory: ".nts/cache" },
  },
});
