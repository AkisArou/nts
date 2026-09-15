# Project configuration, and the platform matrix behind it

Written 2026-09-15, out of a conversation that started with one question -- *the
native lane ships `libc.d.ts` as a prelude; what is the JVM equivalent?* -- and
turned out to be four questions wearing one coat.

**Everything under "Measured" was run against this tree on 2026-09-15 and says
what it was run against. Everything under "Proposed" is a design and says so.**
The RFC names `nts.config.ts` on line 7, dated day one, `Status: Proposed`, with
no semantics attached anywhere else in the document -- so the name is free and
nothing is owed to it. This file is where the semantics get written down.

---

## 1. The question: what is our `libc.d.ts`?

`runtime/native/libc.d.ts` is 363 hand-written lines, checked in, shipped, and
pulled into a build by naming its path in `files`. Its README is explicit that
*compiler-wide automatic loading is not implemented yet*, and the scalar tests
check the curated declarations against the real system headers.

So the native prelude is: **one curated file, shipped, validated against the
authority it describes.**

The JVM lane has no equivalent. What it has is `examples/interop/java-from-ts/
types/prelude.members` -- a **58-line hand-curated member list** -- rendered into
that one example's `types/` directory, covering `java.lang` and `java.util`.
Nothing ships in `runtime/jvm/`.

### Measured: what that curation costs

`nts bind --jar android.jar --package android.util` produces 66 classes and a
64 KB `.d.ts` in 0.6 s. Typechecking it against the curated prelude gives
**60 errors**, and every one is of two kinds:

    57   the prelude is too small   java.io (35), java.util.{function,regex,stream} (19), java.time (3)
     3   no transitive closure      imports java:android.os, java:org.xml.sax, java:org.xmlpull.v1

And it does not close by adding packages one at a time. Generating `java.io`
uncurated took the count **up to 67**, because `java.io` itself needs
`java.nio` (32), `java.security` (4), `java.net` (3), `java.util.stream` (2) and
`java.lang.annotation` (1). It is a fan-out that has to be *closed*, not
extended.

**So the answer is not "a file".** libc is one standard with effectively one
surface; the Java platform is a matrix, and both of its axes are real.

---

## 2. Measured: the platform matrix

### Profile -- desktop JDK against Android

Class counts over `java.{lang,util,io,time,net,nio,math,text,security,function}`,
JDK 21 (Corretto 21.0.5) against `android.jar` from API 36, directory entries
excluded:

    JDK 21        1476
    android.jar   1045
    shared        1035
    JDK only       441
    Android only     10

The ten Android-only classes are `java.lang.Compiler`, `java.security.acl.*` and
`java.util.jar.Pack200` -- **APIs the JDK removed**. So Android is not a subset
of a current JDK; it is close to a subset of an older one, plus retentions.

Two preludes are required, and a library targeting both needs neither of them
alone. See §4.

### Version -- and this axis is cheaper than it looks

Every modern JDK ships `$JAVA_HOME/lib/ct.sym` (11 MB here) holding per-release
API signatures. Checked rather than assumed: `8/java.base/java/lang/String.sig`
begins `cafebabe`, and `javap` reads it directly, printing the **Java 8**
`java.lang.String`. They are class files with a different extension, and they
have no method bodies -- the same property as `android.jar`, which
`escapes.rs` already handles as *unanalysed*.

**One JDK 21 can generate a Java 8, 11, 17 or 21 prelude.** No second JDK, and
no new reader: `compiler/jvm-emitter` consumes these today.

`runtime/jvm/build.sh` builds the runtime jar with `--release 8`, so Java 8 is
the lane's current baseline and the natural desktop default.

### Size

Measured on generated output: a **curated** prelude is ~88 bytes/class
(`java.lang`, 109 classes, 9.5 KB); an **uncurated** one is ~1.6 KB/class
(`java.io`, 82 classes, 135 KB). A full uncurated target is therefore roughly
**1.7 MB** (Android) to **2.4 MB** (JDK 21) of `.d.ts`.

---

## 3. Measured: two properties the design depends on

**`nts bind` is deterministic.** Same jar and package, byte-identical `.d.ts`
*and* `.bind` across runs. This is the precondition for caching anything.

**The `.d.ts` and `.bind` are one atomic artefact.** The binding table is keyed
by byte offsets into the text that same run produced. `java-from-ts/build.sh`
states the consequence: generating them separately is two derivations of one
fact, and the failure is *silent* -- an offset lands one declaration over and
resolves a call to the wrong overload rather than to none. **A cache entry is
the pair, or it is nothing.**

---

## 4. Proposed: preludes are per target, and a target can be a set

A prelude is identified by a **platform target**, not by a package list:

    runtime/jvm/types/
      java8/         desktop default, matching the runtime jar's --release 8
      java21/
      android-29/    the lane's floor
      android-36/

- **Generated from the authority for that target** -- desktop from `ct.sym` via
  the release key, Android from `$ANDROID_HOME/platforms/android-N/android.jar`.
- **Checked in and drift-tested**, exactly as `nts-runtime.jar` is: regenerate
  and compare when a JDK/SDK is present, skip when absent. `nts` still needs no
  JDK to compile TypeScript; a JDK present means drift fails.
- **Content is the closure**, not a curated list. This is the same work as the
  missing transitive closure in §1 -- do it once and both problems close.

### A library shared between Android and desktop takes the intersection

Given 1035 shared / 441 desktop-only / 10 Android-only, picking either target
for a shared library is wrong: built against `java21` it typechecks and then
fails on device for any of 441 classes.

    platform: ["android-29", "java8"]   ->  the intersection

Anything outside the intersection fails to compile **at the library**, which is
where it should fail rather than at the app. Same idea as `javac --release` and
Android lint's `minSdk`, and the intersection is itself deterministic, so it is
just another cache key.

---

## 5. Proposed: `nts.config.ts`, evaluated by node

**Decided: a real TypeScript config, `export default defineConfig({...})`,
evaluated by node.** `defineConfig` gives types and editor completion, and it is
the idiom every user already has from vite, vitest, rollup and tailwind.

An earlier draft of this argued for a *statically evaluable* config on the
grounds that "a cache key cannot be the output of arbitrary code". **That
objection was over-stated and is withdrawn.** Keying the cache on the
**resolved** configuration -- the data structure after evaluation -- is sound by
construction: two packages that resolve to the same config share an entry
whether or not they computed it the same way.

What survives is narrower and worth writing down rather than discovering:

- **Non-determinism costs hits, not soundness.** A config reading the clock, the
  environment or the filesystem resolves differently per run and simply misses
  the cache. Worth a diagnostic when a resolved config changes between two runs
  of an unchanged tree, rather than a rule.
- **Node is required at config time.** The compiler is Rust; reading its own
  settings now needs a JS runtime present. That is a real dependency and should
  be stated, not assumed.
- **Evaluation is per config file**, so the monorepo shape in §6 is about
  generation, not about evaluation.

### tsconfig stays the source of truth

**Decided.** `tsconfig.json` says what TypeScript *is* -- `files`, `include`,
`lib`, `strict`. `nts.config.ts` says what we *build*. It should **reference**
the tsconfig rather than restate anything from it, so the two cannot disagree
about which files are in the program.

    // nts.config.ts
    import { defineConfig } from "nts/config";

    export default defineConfig({
      tsconfig: "./tsconfig.json",          // the source of truth for the program
      platform: ["android-29", "java8"],    // an array means the intersection
      backend: "jvm",
      jvm: {
        sources: [
          { dir: "com/example/java", language: "java",   direction: "ts-calls-java" },
          { dir: "com/example/kt",   language: "kotlin", direction: "ts-calls-java" },
        ],
      },
    });

---

## 6. Proposed: the monorepo answer is "declare per package, generate per key"

Ten workspaces each declaring `android-29` must not generate ten times.

**Declaration is per package; generation is per unique key; the cache is
shared.** The key is a hash of the *resolved* config's relevant slice plus the
input identity:

    key = hash(platform target(s), closure roots, source jar identity, binder version)

Same key, one generation, ten references. Natural homes are the workspace root
(`node_modules/.cache/nts/`) or `~/.cache/nts/`, hardlinked; pnpm's
content-addressed store is the precedent and the model users already hold.

And from §3: **a cache entry is the `.d.ts` and `.bind` together, written
atomically.** Never one half.

---

## 7. Local Java and Kotlin in the same project

### Measured: most of this already works

`nts bind --classes <dir>` takes a **directory of class files**, not only a jar.
`examples/interop/java-from-ts/build.sh` is already `javac` -> `bind --classes`
-> TypeScript, end to end. So `src/**` beside `com/example/**` is a supported
input today; what is missing is that it is a hand-written script rather than a
build step.

### Measured: Kotlin works by construction, and had one real defect

Kotlin emits class files, so the binder consumes it with no new reader. Verified
on `kotlinc-jvm 2.4.20`: a class annotated by the compiler with
`org.jetbrains.annotations.NotNull` and `Nullable`, plus `kotlin.Metadata`.

The binder matched nullability by **suffix** -- `/Nullable` and `/NonNull` --
which is why `androidx`, `javax` and JSpecify all worked without naming a
package. The package was never the question; the spelling was. `NotNull`
appeared nowhere in the crate, and an unannotated reference return becomes
`T | null` by design, so:

    fun greet(): String   ->  greet(): string | null      before
    fun maybe(): String?  ->  maybe(): string | null

**Indistinguishable output for the one distinction Kotlin exists to make.**
Parameters were unaffected, because their default is non-null -- the asymmetry
`nullability_is_asymmetric_between_returns_and_arguments` covers.

Fixed in `5eea691d`: `greet(): string`, `maybe(): string | null`. `android.util`
from `android.jar` is byte-identical before and after, which is the control a
change to a nullability predicate most needs.

### Open: ordering is a genuine cycle

TS-calls-Java needs the bindings before the TypeScript can be checked.
Java-calls-TS needs the emitted classes before the Java can compile.
`examples/interop/android-shape` does both and needs **two passes** for exactly
this reason.

So either each source root declares its direction -- which is why `direction`
appears in the §5 sketch -- or the build is two-phase by construction. It cannot
be inferred from a path, and deferring it means discovering it in a build graph.

### Open: Kotlin beyond the class file

`@kotlin.Metadata` carries what class files do not: default arguments, `internal`
visibility, inline classes. None of it is needed for basic interop; all of it is
needed for idiomatic Kotlin. Not started, and not urgent.

---

## 8. What is decided, and what is open

**Decided**

- `nts.config.ts` with `defineConfig`, evaluated by node.
- `tsconfig.json` stays the source of truth for the program; the config
  references it rather than restating it.
- Preludes are per platform target, generated from that target's authority,
  checked in and drift-tested.
- A platform array means the intersection.
- Declaration per package, generation per resolved key, cache shared; the
  `.d.ts` and `.bind` cached as one atomic pair.

**Open, in the order I would take them**

1. **The closure.** It is the same work as the prelude content, and it is what
   stands between "the JVM lane works" and "you can call Android from
   TypeScript". Everything else here is smaller.
2. **Ship all targets, or generate on demand?** At ~2 MB each this is the
   difference between roughly 8 MB vendored and a build step that needs an SDK.
3. **Where the cache lives** -- workspace root or user home -- and whether it is
   hardlinked.
4. **Direction for Java/Kotlin source roots**, per §7.
5. **A floor that binds a real jar.** Nothing in the gate binds `android.jar`
   today; the two projects that use `bind` use hand-written `com.example` class
   sets of a few classes. A step asserting "the generated binding typechecks"
   would have caught all 60 errors in §1 on the day they appeared.
