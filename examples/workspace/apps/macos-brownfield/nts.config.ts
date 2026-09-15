// **Brownfield: an existing macOS app consumes us.**
//
// Here because it is *not* iOS with a different host, which is the assumption
// worth breaking. Same backend and the same XCFramework format, and then:
//   - a Mac app can also consume a plain `.dylib` or a `.framework`, so the
//     artifact choice is a real choice rather than forced;
//   - **code signing and notarisation** apply to the embedded binary, so a
//     library ships something that must be signable, and an unsigned `.dylib`
//     inside a notarised app is a rejection at distribution time;
//   - and hardened runtime restricts what the embedded code may do -- JIT,
//     unsigned memory -- which is a constraint on a *compiler's output* that no
//     other target here imposes.
import { defineConfig, library } from "@nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  products: {
    sdk: library.macos({
      entry: "./nts/sdk.ts",
      minimumVersion: "14.0",
      exports: ["Sdk"],
      moduleName: "AcmeSdk",
      // Not modelled, and named so it is not mistaken for handled.
      // signing: { identity: "...", hardenedRuntime: true, notarize: true },
    }),
  },
});
