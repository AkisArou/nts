// A jar, because that is what `java/Main.java` compiles against.
//
// The direction this example is named for -- Java calling TypeScript -- is
// exactly what a library product is: the Java program is the consumer and the
// emitted classes are what it links. `ts-from-c` says the same thing one
// backend over.
//
// **`javaPackage` is `nts.gen` and that is a statement about today, not a
// choice.** The emitter hardcodes it, `docs/jvm-interop.md` lists it under
// packaging gaps, and `package_jvm` refuses a jar whose config asks for
// anything else rather than shipping classes somewhere other than where the
// declaration says. `java/Main.java` spells `nts.gen.Session` for the same
// reason, so the two agree about a name neither of them chose.
//
// **This file is why `expected/Api.javap` earns its keep.** Declaring a product
// puts the build on `Roots::EntrySurface` -- what the entry publishes, rather
// than every export of every file -- and that is a second build shape for a
// program that had one. Adding it here found two defects in an afternoon: the
// *methods* of an exported class were dropped, so `Session` survived with its
// fields and constructor while `bump()` and `hits()` did not; and then rooting
// them rooted closure specializations too, which the verifier caught as an
// unreachable block. The capture is what said so both times, before a consumer
// failed to compile against a jar it could not call.
import { defineConfig, library } from "@nts/config";

export default defineConfig({
  products: {
    api: library.jvm({
      entry: "./src/main.ts",
      javaPackage: "nts.gen",
      release: 8,
    }),
  },
});
