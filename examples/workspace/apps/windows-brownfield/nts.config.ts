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
import { defineConfig, library } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    sdk: library.windows({
      entry: "./nts/sdk.ts",
      // Both halves. `library.windows` already defaults `importLibrary` to
      // true, because forgetting it is a link error in the consumer's project
      // rather than in ours.
      moduleDefinition: "acme.def",
    }),
  },
});
