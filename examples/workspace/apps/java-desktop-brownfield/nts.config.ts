// **Brownfield: an existing Maven JVM application depends on us.**
//
// The simplest of the seven, and worth having for exactly that: a jar, resolved
// by coordinates, with no manifest, no signing, no per-architecture anything.
// Everything the other six spend their comments on is absent here.
//
// What is *not* absent:
//   - `nts.gen` as the fixed package name is unacceptable in a published jar,
//     and `docs/jvm-interop.md` already lists it under packaging gaps;
//   - a published jar wants a `module-info` for JPMS consumers, which is a
//     second declaration of the export surface and therefore a second thing that
//     can disagree with `exports`;
//   - and the runtime jar has to be either shaded in or declared as a
//     dependency. Shading duplicates it when two nts libraries meet in one
//     application; declaring it makes the consumer resolve a second artifact.
//     Neither is free and the choice is not made.
import { defineConfig, library } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    sdk: library.jvm({
      entry: "./nts/sdk.ts",
      release: 8,
      javaPackage: "com.acme.sdk",
    }),
  },
});
