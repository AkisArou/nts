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

      // Every exported symbol gets this. C has one flat namespace per process,
      // so `remember` from two libraries is a silent interposition at load
      // rather than a link error -- the hazard the comment above named and no
      // field could express. `src/main.cpp` links `acme_remember` unchanged.
      prefix: "acme_",

      // **A narrower, and the only honest use of it in this fixture.**
      // `nts/sdk.ts` also exports `dumpState`, because the app's own tests
      // import it. Naming the two the ABI publishes keeps `dumpState` out of
      // the header *and* out of the binary: this becomes
      // `hir::reachable::Roots::Entry`, so anything only it reaches stops being
      // a root.
      //
      // Narrower only. A name here that the source does not export is an error,
      // and a *wider* list is a missing keyword in the source rather than a
      // config entry.
      exports: ["remember", "notify"],
    }),

    // The same code as an archive, which is what a consumer links when it will
    // not ship a second file -- and the reason both kinds exist. `static-library`
    // was constructible and nothing in the tree built one, so nothing had ever
    // checked that the two differ only in packaging.
    sdkStatic: library.staticNative({
      targets: [target.linux()],
      entry: "./nts/sdk.ts",
      header: "acme.h",
      prefix: "acme_",
      exports: ["remember", "notify"],
    }),
  },
  // An `add_custom_command` plus a generated CMake config package, so a
  // consumer writes `find_package(Acme)` rather than a path.
  integrate: ["cmake"],
});
