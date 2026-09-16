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
      // No backend named: `target.linux()` defaults to `c`, which is the one
      // that produces an artifact. This said `backend: "c"` out loud for as
      // long as the default was `llvm`, which cannot write a program -- and a
      // comment explaining a workaround is what a broken default looks like
      // from inside a config.
      targets: [target.linux()],
      entry: "./src/main.ts",
    }),
  },
});
