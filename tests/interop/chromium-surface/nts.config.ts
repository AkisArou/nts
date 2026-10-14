// A program for Chromium's renderer, through both backends: `target.chromium()`
// types it against the DOM -- lib.dom.d.ts bound to `nts:dom` by delegation --
// and links the DOM's native half, so neither tsconfig.json nor this file
// lists either.
import { defineConfig, library, target } from "@nts/config";

export default defineConfig({
  products: {
    app: library.staticNative({ entry: "./src/main.ts", targets: [target.chromium()] }),
    appLlvm: library.staticNative({ entry: "./src/main.ts", targets: [target.chromium({ backend: "llvm" })] }),
  },
});
