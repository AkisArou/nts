import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  // `tsconfig` defaults to `./tsconfig.json` beside this file.
  workspace: { root: "." },

  products: {
    // The first vertical slice (RFC §40): a native shared library, no UI, no
    // platform toolchain.
    //
    // `library.native` rather than a flat `library({ kind, target })`: the
    // backend and the `.pc` file come from the constructor, and the fields that
    // mean nothing here -- `javaPackage`, `moduleName` -- are not expressible
    // rather than merely unused.
    //
    // One constructor across Linux, macOS and Windows, because `.so`, `.dylib`
    // and `.dll` are one kind of artifact with different packaging. The Apple
    // *distribution* format is `library.xcframework` and is a separate choice.
    //
    // No `prefix`: it defaults to the product name, and this library's two
    // symbols are not colliding with anything.
    //
    // No `exports`: the entry's are the surface, and naming them again was a
    // second statement of one fact. The field is a *narrower*, for an entry that
    // re-exports more than the artifact should carry.
    //
    // No memory provider either: it is a `--rc` flag rather than configuration,
    // because of the two the compiler has, exactly one is shippable.
    hello: library.native({
      // **`backend: "c"` is said out loud**, because `target.linux()` defaults
      // to llvm and the llvm backend cannot write a program yet -- its slice is
      // scalar and there is no runtime to place beside it. `nts build` refuses
      // that target by name rather than skipping it, so this is the difference
      // between an artifact and a message saying why there is none.
      targets: [target.linux({ backend: "c" })],
      entry: "./src/main.ts",
    }),
  },
});
