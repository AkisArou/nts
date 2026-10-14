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
import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    sdk: library.native({
      targets: [target.windows()],
      entry: "./nts/sdk.ts",
      // As on Linux: the namespace belongs in the config, not in the
      // identifiers. `src/main.cpp` links `acme_remember` either way.
      prefix: "acme_",
    }),
  },
  // An MSBuild `.targets` import. The one ecosystem where the hook and the
  // package format are separable: NuGet ships the `.targets` that runs us.
  integrate: ["msbuild"],
  // vcpkg for the C++ half. NuGet is the other answer and they are not
  // interchangeable -- shipping for one leaves half the consumers unable to
  // resolve you, which is the same bind as SwiftPM against CocoaPods on Apple.
  dependencies: {
    windows: { from: "vcpkg", lockfile: "./deps/vcpkg.json" },
  },
});
