// A static archive whose **module scope** has work to do.
//
// `library.staticNative` bundles the runtime and the program into one `.a`.
// Module-level state is evaluated by `module__init`, which a library runs from
// an `.init_array` constructor so a consumer cannot forget to — see the long
// argument in `tooling/cli/src/main.rs` beside `PROGRAM_SOURCE_NAME`.
//
// The constructor has to live in `program.c` and not in a file of its own,
// because a static library member is linked only if something already
// references it and a translation unit holding nothing but a constructor never
// is. This example exists because that was wrong for a month and nothing here
// could see it: every other interop example keeps its state inside functions,
// so `module__init` had nothing to do and dropping it changed no answer.
import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  products: {
    lib: library.staticNative({
      targets: [target.linux({ backend: "c" })],
      entry: "./src/main.ts",
    }),
  },
});
