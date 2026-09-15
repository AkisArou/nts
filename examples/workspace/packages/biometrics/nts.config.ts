// Android and iOS only. The package that asks what a target set *means*.
//
// `targets` here is a claim, not a preference: there is no biometric prompt on
// a Linux server. A desktop app that depends on this must fail **at
// configuration time**, naming this package and the target it cannot satisfy --
// not at link time with a missing symbol, and certainly not at run time.
//
// That check does not exist yet. It is the concrete reason a package declares
// its targets rather than inheriting the app's.
import { defineConfig, sources } from "nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  targets: ["android-29", "ios-17"],
  native: [
    sources({
      dir: "native/android/com/example/biometrics",
      language: "java",
      targets: ["android-29"],
      direction: "ts-calls-native",
    }),
    sources({
      dir: "native/apple",
      language: "c",
      targets: ["ios-17"],
      direction: "ts-calls-native",
      header: "native/apple/prompt.h",
    }),
  ],
});
