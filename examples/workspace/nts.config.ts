// Workspace root. Defaults only -- no products.
//
// **Products live in apps, not here.** RFC §34 shows one config with every
// product in it, which reads well for a single project and does not survive a
// monorepo: `apps/android` and `apps/ios` are separately buildable and
// separately owned, and a root file listing both makes every app's build depend
// on every other app's config parsing.
//
// So the root carries what is genuinely shared -- debug policy, cache location,
// the workspace's tsconfig base -- and each app carries its own products. This
// is the one place this fixture departs from §34, and it departs on purpose.
//
// Packages have no products at all. Most have no config: see
// `packages/storage` and `packages/telemetry`.
import { defineConfig, debug } from "nts/config";

export default defineConfig({
  workspace: {
    root: ".",
    // Referenced, never restated. tsconfig stays the source of truth for what
    // the program is; this file says what gets built.
    tsconfigBase: "./tsconfig.base.json",
    packages: ["apps/*", "packages/*"],
  },

  defaults: {
    debug: debug.development({ sourceMaps: "full", asyncStacks: true }),
  },

  build: {
    // §34 already reserves this. Project bindings are cached here, keyed on the
    // resolved config; platform type surfaces are npm dependencies and are not
    // cached because they are not generated.
    cache: { local: true, directory: ".nts/cache" },
  },
});
