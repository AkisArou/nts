import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  // `tsconfig` defaults to `./tsconfig.json` beside this file.
  workspace: { root: "." },

  products: {
    // The first vertical slice (RFC §40): a native shared library, no UI, no
    // platform toolchain.
    //
    // `library.linux` rather than a flat `library({ kind, target })`: the
    // target, the backend and `pkgConfig` come from the constructor, and the
    // fields that mean nothing here -- `javaPackage`, `moduleName`, `soname`
    // on a target that has no soname -- are not expressible rather than merely
    // unused.
    //
    // No `exports`: the entry's are the surface, and naming them again was a
    // second statement of one fact. The field is a *narrower*, for an entry that
    // re-exports more than the artifact should carry.
    //
    // No memory provider either: it is a `--rc` flag rather than configuration,
    // because of the two the compiler has, exactly one is shippable.
    hello: library.native({
      targets: [target.linux()],
      entry: "./src/main.ts",
    }),
  },
});
