// One entry, four targets, two backends.
//
// **The product that crosses every axis at once**, and the reason the fixture
// has a react app at all: `apps/android` and `apps/ios` are separate products
// because their runtime, memory strategy and host differ. Here they do not --
// the react host is the same in each -- so it is one product with four targets
// and the build fans out.
//
// That asymmetry is the open question this app exists to pose: when is a
// multi-platform app one product with N targets, and when is it N products? The
// answer here is "when everything except the target is the same", and nothing
// enforces it.
//
// No React dependency is declared. This names a planned feature.
import { defineConfig, app, target } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    mobile: app({
      entry: "./src/main.tsx",
      id: "dev.example.workspace.react",
      targets: [
        target.android({ minSdk: 29 }),
        target.ios({ minimumVersion: "17.0" }),
        target.macos({ minimumVersion: "14.0" }),
        target.windows(),
      ],
      // profiles: [react.native()] -- the planned feature, not declared here.
    }),
  },
});
