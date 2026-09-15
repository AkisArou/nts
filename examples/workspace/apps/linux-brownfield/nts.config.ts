// **Brownfield: an existing CMake/C++ program links us.**
//
// The one with no package manager, which makes it the honest floor. There is no
// resolver to consume and nothing to publish to: a consumer finds the library
// through `pkg-config`, a CMake config package, or a hard-coded path.
//
// What a shared library owes its consumer here, none of which an app needs:
//   - a **versioned soname** (`libacme.so.0`), so an ABI break is a link error
//     rather than a crash;
//   - **symbol visibility** -- everything not exported hidden, or our internals
//     collide with theirs at load;
//   - an installable **header**, which is the C equivalent of `exports`;
//   - and a `.pc` file, because that is how the search actually happens.
import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    sdk: library.native({
      targets: [target.linux()],
      entry: "./nts/sdk.ts",
      soname: "libacme.so.0",
      header: "acme.h",
    }),
  },
});
