// TypeScript calling Java, built as a jar.
//
// **`native` is the Java half, and declaring it is what compiles it.** The three
// files under `java/` are an ordinary Java library -- zero `nts.gen` references,
// so nothing here is circular -- and `nts build` compiles them with `javac` and
// packages them beside the emitted classes. Without this the artifact would
// carry the TypeScript and none of what it calls into, and would fail at the
// first crossing with a `NoClassDefFoundError`.
//
// The declarations in `types/` stay committed and `build.sh` regenerates and
// diffs them. That is a drift check rather than a build step: `nts bind` reads
// the compiled classes, and a `.d.ts` this build generated silently would be
// one nobody had reviewed.
import { defineConfig, library, sources } from "@nts/config";

export default defineConfig({
  products: {
    api: library.jvm({
      entry: "./src/main.ts",
      javaPackage: "nts.gen",
      release: 8,
    }),
  },
  native: [sources({ dir: "java" })],
});
