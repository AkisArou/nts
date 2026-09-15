// Notifications: five platforms, four native languages, and a callback.
//
// **Two fields were removed from this file and the removals are the point.**
//
// `language` is gone. It is derivable from the extension -- `.java`, `.kt`,
// `.swift`, `.cs`, `.c`, `.m` -- and a directory may legitimately hold two
// (`.java` beside `.kt` is ordinary, and both become class files). Declaring it
// made the config a second derivation of a fact the filesystem already carries,
// and two derivations of one fact disagree eventually.
//
// `direction` is gone, and the previous version of this file is the argument
// against it: it declared `native/android/...` **twice**, once per direction.
// A directory that appears twice with opposite values is not described by that
// field. Direction is a property of *edges*, not of source roots --
// `Scheduler.java` is called by TypeScript and calls back into it, in one file.
//
// So it is inferred, the way mutual recursion always is -- declarations before
// bodies:
//
//   1. read the native declarations and generate bindings;
//   2. typecheck TypeScript, emit our artefacts;
//   3. compile the native bodies against both.
//
// That works here because `setTapHandler` takes an opaque handle rather than a
// type we generate. Where a native signature *names* a generated type the cycle
// is real, and it is detectable at step 1 -- the honest answers are a two-phase
// compile or a refusal that says which signature caused it. Neither is a field
// the user should have to write.
import { defineConfig, sources, manifest } from "nts/config";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  targets: ["android-29", "ios-17", "macos-14", "linux-gnu", "windows"],

  native: [
    // Java. Bound from class files, which is what this compiler reads today.
    sources({ dir: "native/android/com/example/notifications", targets: ["android-29"] }),

    // Swift. Pretend-supported: the realistic route is `swiftc
    // -emit-objc-header`, so binding Swift is "generate a header we already
    // read" rather than a new reader.
    sources({ dir: "native/apple", targets: ["ios-17", "macos-14"] }),

    // C. The only one where a C surface is the honest one -- libnotify is a C
    // library, so nothing is standing in for anything.
    sources({ dir: "native/linux", targets: ["linux-gnu"], header: "native/linux/scheduler.h" }),

    // WinRT. Pretend-supported, and structurally the nearest of the three:
    // `.winmd` is ECMA-335 metadata, so the reader in `compiler/jvm-emitter` is
    // the shape that transfers. The calling convention is not -- WinRT is COM.
    sources({ dir: "native/windows", targets: ["windows"] }),
  ],

  // **What a package contributes to its consumer's app besides code.**
  // Precedent is already in this tree: `runtime/jvm/web-platform/android/` ships
  // an `AndroidManifest.xml` with a permission and a `consumer-rules.pro`, and
  // AGP merges them. We should not reimplement manifest merging; we should emit
  // something the platform's own merger understands.
  //
  // A consumer forgetting POST_NOTIFICATIONS gets a silent no-op at run time,
  // and a consumer forgetting the iOS background mode fails App Review. Neither
  // is a failure a package should be able to inflict by omission.
  manifests: [
    manifest({ target: "android-29", path: "manifests/android.xml" }),
    manifest({ targets: ["ios-17", "macos-14"], path: "manifests/apple.plist" }),
    manifest({ target: "windows", path: "manifests/windows.appxmanifest" }),
    manifest({ target: "linux-gnu", path: "manifests/linux.desktop" }),
  ],

  // **Resolved artefacts, pinned -- not a resolver we drive.**
  // `runtime/jvm/web-platform/android/dependencies.tsv` already takes this
  // position and states why: "a version range or a `+` would make the artifact
  // that ships differ from the artifact that was reviewed, which is the whole
  // of a supply-chain problem in one line."
  //
  // So we consume each ecosystem's *resolved output* -- a Gradle or Maven
  // classpath, `Package.resolved`, `Podfile.lock`, `pkg-config --libs` -- and
  // record exact versions with digests. We do not parse `build.gradle`, which
  // is a Turing-complete program, any more than we parse a Makefile.
  dependencies: {
    "android-29": { from: "gradle", lockfile: "./deps/android.tsv" },
    "ios-17": { from: "swiftpm", lockfile: "./deps/apple.resolved" },
    "linux-gnu": { from: "pkg-config", packages: ["libnotify"] },
  },
});
