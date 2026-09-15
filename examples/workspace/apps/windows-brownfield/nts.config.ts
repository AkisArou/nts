// **Brownfield: an existing MSBuild/C++ project links us.**
//
// Windows splits what every other platform keeps together: a `.dll` is the
// runtime artifact and a `.lib` is the *import library* the linker needs, so a
// consumer needs both and neither alone is useful. There is no soname; the
// version lives in a resource and in the file name by convention.
//
// Distribution has two answers and they are not interchangeable: **NuGet** for
// managed and increasingly native consumers, and **vcpkg** for C++ -- which is
// the same "ship for both resolvers or be unavailable to half your consumers"
// problem as SwiftPM against CocoaPods on Apple.
import { defineConfig, library, target } from "nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    sdk: library({
      entry: "./src/sdk.ts",
      kind: "shared",
      target: target.windows({ backend: "llvm" }),
      runtime: { family: "native", memory: { provider: "rcCycle" } },
      exports: ["acme_remember", "acme_notify"],
      // Both halves, named because forgetting the import library is a link
      // error in the consumer's project rather than in ours.
      windows: { importLibrary: true, moduleDefinition: "acme.def" },
    }),
  },
});
