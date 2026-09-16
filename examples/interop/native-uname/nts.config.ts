// A static archive, because that is what `native/caller.c` links against.
//
// **`build.sh` used to be this file's contents, written out.** It ran `emit-c`,
// compiled the witness, compiled the runtime and the program, and linked --
// which is the pipeline, and is the same pipeline in all sixteen interop
// examples. `nts build` does that from here now, and what is left in the script
// is the part an interop example is actually for: a separately compiled C
// consumer, and running it.
import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  products: {
    uname: library.staticNative({
      targets: [target.linux({ backend: "c" })],
      entry: "./src/main.ts",
    }),
  },
});
