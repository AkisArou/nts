// A static archive, with the package's own C compiled into it.
//
// **`native/` is the library and `consumer/` is the program that links it.**
// They were one directory, and `sources({ dir: "native" })` would have put a
// `main()` into the archive -- so the consumer moved out. That is right
// independently of this build: a program that tests a library is not part of it.
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
