// **Brownfield: an existing Android app consumes us.**
//
// Everything inverts relative to `apps/android`. There, nts builds the app and
// owns the manifest, the entry point and the packaging. Here, `app/` is somebody
// else's Gradle project that already exists, already ships, and is not going to
// be rewritten -- and we are a dependency it adds.
//
// So the product is a **library**, not an app:
//   - `exports` stops being a packaging detail and becomes the public API;
//   - our manifest fragments merge into *their* AndroidManifest, not ours;
//   - our R8 rules ship as `consumerProguardFiles` so their minifier keeps what
//     reflection reaches;
//   - and the artifact has to be something Gradle can resolve, which means an
//     **AAR** -- not a directory of class files.
//
// That last point is the reverse direction `docs/nts-config.md` §6c names as
// unanswered: consuming a package manager's resolved output is one problem, and
// *emitting something it resolves* is another. This app is the case for it.
import { defineConfig, library, target } from "nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    sdk: library({
      entry: "./src/sdk.ts",
      kind: "aar",
      target: target.android({ backend: "jvm", minSdk: 29 }),
      runtime: { family: "jvm", memory: { provider: "hostGC" } },

      // The contract. `examples/interop/ts-from-java` pins its published Java
      // surface in `expected/Api.javap` and diffs it on every build; a library
      // consumed by someone else's app wants exactly that, and for the same
      // reason -- the surface is the thing that cannot change quietly.
      exports: ["Sdk"],

      // Java package for the generated classes. `nts.gen` is the current fixed
      // name and is wrong for a shipped library: `docs/jvm-interop.md` lists it
      // under packaging gaps.
      javaPackage: "com.acme.sdk",
    }),
  },
});
