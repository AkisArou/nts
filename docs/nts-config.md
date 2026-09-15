# Products, targets, and configuration

**Rewritten 2026-09-15.** The first version of this file was written from inside
the JVM lane and was shaped by it: a flat config with a `jvm:` key, and a
prelude question answered only for Java. That framing was too small, and the
correction came with three specific arguments that are now the spine of this
document -- that a monorepo package should not need a config file at all, that a
shipped type surface is an ordinary npm dependency rather than something we
generate, and that `products` in RFC §34 already has the vocabulary for the
artifact matrix.

**Measured** sections were run against this tree on 2026-09-15 and say what
against. **Proposed** sections are design. The RFC's configuration is itself
marked *Proposed* and is day-one text that no engineering has revised.

---

## 1. Three axes that keep getting collapsed into one

A build is identified by three things, and conflating any two of them produces a
config that cannot express something real.

| axis | values today | note |
| --- | --- | --- |
| **artifact kind** | app, library | a library has a chosen export surface; an app has an entry |
| **target** | linux, macos, ios, android, windows, jvm-desktop, node-addon | the platform the artifact runs on |
| **backend** | C, LLVM, JVM | *how* code is generated |

**Backend is not target.** `Backend` in `codegen/common` has exactly three
variants -- C, Llvm, Jvm -- so iOS and macOS are not backends; they are LLVM
plus a triple plus a host. RFC §34 already has this right (`target.ios({ backend:
"llvm" })`), and it is worth stating because "the iOS backend" is an easy and
wrong thing to say.

### Measured: what exists today

- Three backends, `Backend::{C, Llvm, Jvm}`.
- Real artifacts: C source, textual LLVM IR, JVM class files, a **Node addon**
  (`emit-c --napi`), and DEX via `d8` in `tooling/android`.
- Jars and test APKs are produced today by hand-written scripts --
  `examples/interop/*/build.sh`, `tooling/android/proxy-app.sh` -- not by the
  compiler. **AARs, app bundles, `.dylib` and Windows packages are produced by
  nothing at all**; they exist only in the RFC.

So the pipeline below is mostly not built. What is built is every *backend* it
would dispatch to, which is the harder half.

---

## 2. Where configuration is required -- and where it is not

**This is the correction that reframed the document.** In a Vite monorepo only
the app has `vite.config`; packages are ordinary TypeScript. The same should be
true here, and the rule that makes it true is:

> **A config file is required exactly where there is a build step.**

Three cases fall out:

| package contains | needs `nts.config.ts`? | why |
| --- | --- | --- |
| TypeScript only, consumed by an app | **no** | it produces no artifact; the app compiles it |
| TypeScript, and *is* an artifact | yes | it has products |
| TypeScript **plus Java/Kotlin/C sources** | yes | `javac`/`kotlinc`/`clang` must run, in an order |

The third row is the one worth being careful about, and it was raised as a
worry: a package that intermixes TypeScript and Java **does** need a config,
because there is a compile step with an ordering constraint, and no amount of
type-level cleverness removes it. That is not a flaw in the rule -- it *is* the
rule. Mixing languages is a build step.

### What a pure-TypeScript package needs instead

It needs its *type environment* to be right so it typechecks in isolation -- in
the editor, and in `tsc --noEmit` in CI. TypeScript already has the mechanism:

```jsonc
// packages/ui/tsconfig.json — no nts config anywhere
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@nts/platform-android-29"] }
}
```

That is an ordinary npm dependency carrying generated `.d.ts`. It requires no
nts config, no generation step, and no cache: **pnpm already solved
content-addressed sharing.** Ten packages depending on
`@nts/platform-android-29` get one copy on disk and ten references, which is a
better answer than anything we would build.

---

## 3. Proposed: two kinds of type surface, and only one is ours to generate

The earlier draft treated every `.d.ts` as something we generate and cache. That
is right for one kind and wrong for the other, and separating them dissolves most
of the monorepo problem.

**Platform surfaces -- published, versioned, not generated.**
`@nts/platform-android-29`, `@nts/platform-java8`, `@nts/platform-ios-17`,
`@nts/platform-libc`. We generate these *once, in this repository*, at release
time, and publish them. A user never runs a generator and never needs an SDK
installed to typecheck. This is what `runtime/native/libc.d.ts` already is in
spirit -- a shipped, curated surface -- except versioned per target instead of
being one file.

**Project surfaces -- generated and cached.** Bindings for *your* jars, *your*
local Java/Kotlin, *your* C headers. These cannot be published because they are
yours. Here the caching design stands:

    key = hash(resolved config slice, input identity, binder version)

Declaration per package, generation per key, cache shared -- RFC §34 already
reserves `build.cache.directory: ".nts/cache"`. Two measured constraints from
the JVM binder carry over to any generator: it is **deterministic** (byte
identical across runs, verified), and the `.d.ts` and its binding table are
**one atomic artefact**, because the table is keyed by byte offsets into the text
that same run produced.

---

## 4. Proposed: products, and the app/library asymmetry

RFC §34's vocabulary is the right one and this document adopts it rather than
inventing a flatter shape:

```ts
export default defineConfig({
  workspace: { root: ".", tsconfig: "./tsconfig.json" },
  products: {
    android: app({ entry, target: target.android({ backend: "jvm", minSdk: 29 }), runtime, host, profiles, modules }),
    ios:     app({ entry, target: target.ios({ backend: "llvm", minimumVersion: "17.0" }), runtime, host, profiles }),
    core:    library({ entry, kind: "shared", exports: [...] }),
  },
});
```

**An app is one product per target.** Android and iOS differ in runtime family,
memory strategy, host services and UI -- they are not one build with a flag, and
§34 models them as separate products sharing an entry. That is correct.

**A library is one product with many targets**, and this asymmetry matters:

```ts
core: library({
  entry: "./src/library.ts",
  targets: ["android-29", "java8", "ios-17", "linux-gnu"],
  exports: ["createClient", "processMessage", "destroyClient"],
})
```

A library must **typecheck once against the intersection** of its targets' type
surfaces, and **emit once per target**. Typechecking per target would let a
library compile for Android and fail for desktop with no single place the error
belongs; typechecking against a union would let it use an API that is missing on
one of them.

### Measured: why the intersection is not a formality

Class counts over `java.{lang,util,io,time,net,nio,math,text,security,function}`,
JDK 21 against `android.jar` API 36, directory entries excluded:

    JDK 21        1476        shared        1035
    android.jar   1045        JDK only       441
                              Android only     10   <- APIs the JDK *removed*

A library built against `java21` and shipped to Android typechecks, then fails on
device for any of 441 classes. Android is not a subset of a current JDK; it is
close to a subset of an older one plus retentions (`java.lang.Compiler`,
`java.security.acl.*`, `Pack200`).

`exports` is doing real work here too -- one of the measured JVM packaging gaps
is that *the public surface is every export*, so a library cannot choose one.

---

## 5. Proposed: `nts.config.ts`, evaluated by node

**Decided.** `export default defineConfig({...})`, evaluated by node.
`defineConfig` gives types and completion, and it is the idiom users already have
from vite, vitest, rollup and tailwind.

An earlier draft argued for a *statically evaluable* config because "a cache key
cannot be the output of arbitrary code". **That objection was over-stated and is
withdrawn.** Keying on the **resolved** configuration -- the data structure after
evaluation -- is sound by construction: two packages that resolve to the same
config share a cache entry however they computed it.

What survives is narrower and is recorded rather than left to be discovered:

- **Non-determinism costs cache hits, not correctness.** A config reading the
  clock, the environment or the filesystem resolves differently per run and
  misses. Worth a diagnostic when an unchanged tree resolves differently twice.
- **Node becomes a config-time dependency** for a compiler that is otherwise
  Rust. Real, and better stated than assumed.

**`tsconfig.json` stays the source of truth** for what the program *is* --
`files`, `include`, `lib`, `strict`, and `types` for the platform surface. The
nts config **references** it and restates none of it, so the two cannot disagree
about which files are in the program. §34 already has `workspace.tsconfig`.

---

## 6. The JVM instance, measured

Everything above is general. This section is the lane where it has been measured,
and it is kept because the numbers are what made the general shape necessary.

**The prelude today is curated and too small.** `examples/interop/java-from-ts/
types/prelude.members` is 58 hand-curated lines covering `java.lang` and
`java.util`. Binding one Android package against it:

    nts bind --jar android.jar --package android.util   66 classes, 64 KB, 0.6 s
    typecheck                                            60 errors

    57   prelude too small    java.io (35), java.util.{function,regex,stream} (19), java.time (3)
     3   no closure           imports java:android.os, java:org.xml.sax, java:org.xmlpull.v1

It does not close by adding packages one at a time: generating `java.io`
uncurated took the count **up to 67**, because `java.io` needs `java.nio` (32),
`java.security` (4), `java.net` (3), `java.util.stream` (2) and
`java.lang.annotation` (1).

**The version axis is cheaper than it looks.** Every modern JDK ships
`$JAVA_HOME/lib/ct.sym` (11 MB here) with per-release API signatures. Checked
rather than assumed: `8/java.base/java/lang/String.sig` begins `cafebabe` and
`javap` reads it, printing the **Java 8** `String`. They are class files with no
method bodies -- the same property as `android.jar`, which `escapes.rs` already
treats as unanalysed. **One JDK 21 generates a Java 8, 11, 17 or 21 surface with
the reader we already have.** `runtime/jvm/build.sh` targets `--release 8`, so
Java 8 is the current baseline.

**Size.** Curated ~88 bytes/class; uncurated ~1.6 KB/class. A full uncurated
target is ~**1.7 MB** (Android) to ~**2.4 MB** (JDK 21) of `.d.ts` -- which is an
ordinary npm package, and another reason §3 publishes rather than generates them.

**Local Java and Kotlin already work.** `bind --classes <dir>` takes a directory,
and `examples/interop/java-from-ts/build.sh` is `javac` -> `bind` -> TypeScript
end to end. Kotlin needs no new reader: verified on `kotlinc-jvm 2.4.20`, one
defect found and fixed in `5eea691d` -- the binder matched `/NonNull` and Kotlin
writes `org.jetbrains.annotations.NotNull`, so every non-null Kotlin return bound
as `T | null` and `fun greet(): String` was indistinguishable from
`fun maybe(): String?`.

**Ordering is a genuine cycle.** TS-calls-Java needs bindings before the
TypeScript is checked; Java-calls-TS needs emitted classes before the Java
compiles. `examples/interop/android-shape` does both and needs two passes. So a
mixed source root must declare its direction; it cannot be inferred from a path.

---

## 7. Decided, and open

**Decided**

- Three axes, kept apart: artifact kind, target, backend.
- A config file is required exactly where there is a build step; a pure-TypeScript
  package needs none, and gets its type environment from `types: [...]`.
- Platform type surfaces are **published npm packages**, generated in this repo
  at release time -- not generated on the user's machine.
- Project bindings are generated and cached, keyed on the resolved config, with
  the `.d.ts` and its table cached as one atomic pair.
- `nts.config.ts` with `defineConfig`, evaluated by node; `tsconfig.json` remains
  the source of truth and is referenced, not restated.
- Apps are one product per target; libraries are one product over many targets,
  typechecked against the intersection.

**Open, in the order I would take them**

1. **The transitive closure**, for whichever surface is being generated. It is
   the same work as the prelude content and it blocks the publishable packages.
2. **Which platform packages ship, and their versioning.** `@nts/platform-*`
   needs a naming and release story; the per-target size is ~2 MB.
3. **Direction on mixed source roots**, per §6.
4. **A floor that binds a real jar.** Nothing in the gate binds `android.jar`;
   the two projects using `bind` use hand-written `com.example` class sets.
5. **Artifact emission itself** -- jars, `.so`, AARs, app bundles are shell
   scripts today. This is the largest item and it is cross-lane.

**Ownership note.** §1--§5 are cross-lane by construction: they touch the native
lane (`libc.d.ts`, C headers, `--napi`) and the node lane as much as the JVM one.
The measurements in §6 are the JVM lane's and were taken here; the general design
needs the other lanes to agree before anything is built against it.
