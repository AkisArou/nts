// An iterator that escapes its buffer's block (see src/main.ts): the known
// gap, expected to fail under `--rc`. Its own project, so each program runs
// one `main`.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    escape: app.linux({ entry: "./src/main.ts", backend: "c" }),
    "escape-llvm": app.linux({ entry: "./src/main.ts", backend: "llvm" }),
  },
  // No `native`: the shim is `../native`, which the parent package -- whose
  // `../types/sub.d.ts` this program includes -- already contributes.
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4"] },
  },
});
