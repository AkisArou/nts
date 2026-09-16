// A static archive, because that is what `native/caller.c` links against.
//
// The direction this example is named for -- C calling TypeScript -- is exactly
// what a library product is: the C program is the consumer and the TypeScript is
// the thing it links.
import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  products: {
    lib: library.staticNative({
      targets: [target.linux({ backend: "c" })],
      entry: "./src/main.ts",
    }),
  },
});
