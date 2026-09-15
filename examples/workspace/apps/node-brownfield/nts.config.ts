// **Brownfield: an existing Node project requires us.**
//
// The one target where the artifact is real today -- `emit-c --napi` produces a
// Node addon. What is not handled is everything around it, and a published npm
// package needs all of it:
//   - **one binary per platform and architecture**, because a `.node` is native.
//     darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64 is five, and
//     that is before musl;
//   - **Node-API version pinning**, which is what makes one binary work across
//     Node majors -- the whole reason to target N-API rather than V8 directly;
//   - and either `optionalDependencies` per platform or a prebuild fetched at
//     install, which are two different failure modes for a user offline.
import { defineConfig, library } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    addon: library.node({
      entry: "./nts/sdk.ts",
      apiVersion: 8,
      platforms: ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"],
    }),
  },
});
