// A static archive, because that is what `native/caller.c` links against.
//
// **`build.sh` used to write the pipeline out.** It ran `emit-c`, compiled the
// witness, compiled the runtime and the program, and linked -- the same five
// steps in all sixteen interop examples, each able to drift from what the
// compiler emits. `nts build` does them from here; what is left in the script
// is what an interop example is for: a separately compiled C consumer, and
// running it.
import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  products: {
    lib: library.staticNative({
      targets: [target.linux({ backend: "c" })],
      entry: "./src/main.ts",
    }),
  },
});
