// A static archive, with the package's own C compiled into it.
//
// **`native/` is the library and `consumer/` is the program that links it.**
// They were one directory, and `sources({ dir: "native" })` would have put a
// `main()` into the archive.
//
// This example was the last of the sixteen still writing its pipeline out, and
// for a reason: its binding is an opaque `struct Counter`, and the emitted
// witness declared `extern void counter_destroy(struct Counter *)` without
// anything that declares the tag -- so it did not compile, and this script was
// the only one with no `-fsyntax-only` line. The witness forward-declares the
// tag now, so the check this example never had is the check it runs.
import { defineConfig, library, sources, target } from "@nts/config";

export default defineConfig({
  products: {
    lib: library.staticNative({
      targets: [target.linux({ backend: "c" })],
      entry: "./src/main.ts",
    }),
  },
  native: [sources({ dir: "native" })],
});
