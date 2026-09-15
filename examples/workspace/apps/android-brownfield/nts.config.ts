// **Brownfield: an existing Android app consumes us.**
//
// Everything inverts relative to `apps/android`. There, nts builds the app and
// owns the manifest, the entry point and the packaging. Here, `app/` is somebody
// else's Gradle project that already exists, already ships, and is not going to
// be rewritten -- and we are a dependency it adds.
//
// So the product is a **library**, not an app:
//   - `exports` stops being a packaging detail and becomes the public API;
//   - our manifest fragments merge into *their* AndroidManifest, not ours;
//   - our R8 rules ship as `consumerProguardFiles` so their minifier keeps what
//     reflection reaches;
//   - and the artifact has to be something Gradle can resolve, which means an
//     **AAR** -- not a directory of class files.
//
// That last point is the reverse direction `docs/nts-config.md` §6c names as
// unanswered: consuming a package manager's resolved output is one problem, and
// *emitting something it resolves* is another. This app is the case for it.
import { defineConfig, library } from "@nts/config";

export default defineConfig({
  products: {
    sdk: library.android({
      entry: "./nts/sdk.ts",
      minSdk: 29,

      // Java package for the generated classes. `nts.gen` is the current fixed
      // name and is wrong for a shipped library: `docs/jvm-interop.md` lists it
      // under packaging gaps.
      javaPackage: "com.acme.sdk",

      // Shipped inside the AAR as `consumerProguardFiles`, so the consumer's R8
      // keeps what our reflection reaches. The comment above has claimed this
      // since the file was written and no field said it.
      consumerProguard: "./proguard-rules.pro",
    }),
  },
  // A Gradle plugin registering our compile as a task wired into `preBuild`,
  // declaring its inputs and outputs so a consumer build is not a full rebuild
  // every time. Without a hook the consumer runs us by hand and forgets.
  integrate: ["gradle"],
});
