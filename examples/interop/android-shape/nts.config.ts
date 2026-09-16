// TypeScript calling Java shaped like the Android SDK, built as a jar.
//
// **`native` names `java/com/example/ui` and not `java`.** The directory above
// it also holds `Demo.java` and `Run.java`, which are *consumers* -- one a pure
// Java demo, the other the program that calls into the emitted classes and
// prints the line this example asserts. A root is the library a package
// contributes, so scoping it to the package directory is what keeps the
// consumers out of the artifact. `build.sh` compiles those two itself, against
// what this produces.
//
// Nothing here needs `android.jar`: the classes are shaped *after* android's --
// that is the whole point of the fixture, and what broke the binder -- but the
// only mentions of `android.` in them are in comments.
import { defineConfig, library, sources } from "@nts/config";

export default defineConfig({
  products: {
    api: library.jvm({
      entry: "./src/main.ts",
      javaPackage: "nts.gen",
      release: 8,
    }),
  },
  native: [sources({ dir: "java/com/example/ui" })],
});
