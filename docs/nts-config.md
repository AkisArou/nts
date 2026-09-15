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

## 6a. Two fields that should not exist, and why

`examples/workspace` was built to argue against, and it argued two fields out of
the config on its first reading.

**`language` on a source root is derivable** from the extension, and a directory
may legitimately hold two -- `.java` beside `.kt` is ordinary, and both become
class files. Declaring it makes the config a second derivation of something the
filesystem already carries.

**`direction` was the wrong shape entirely, and the fixture proved it.** The
first version declared `native/android/...` **twice**, once per direction,
because `Scheduler.java` is called by TypeScript *and* calls back into it. A
directory that must appear twice is not described by that field: direction is a
property of edges, not of roots.

It is inferred the way mutual recursion always is -- **declarations before
bodies**:

1. read native declarations and generate bindings;
2. typecheck TypeScript and emit our artefacts;
3. compile native bodies against both.

That resolves the cycle whenever the native signature takes an *opaque handle*
(`setTapHandler(Object)`). Where a native signature **names a type we generate**
the cycle is real -- and it is detectable at step 1, so the honest answers are a
two-phase compile or a refusal naming the signature. Neither is a field a user
should have to write.

## 6b. What a package contributes besides code

Precedent already decided this. `runtime/jvm/web-platform/android/` ships an
`AndroidManifest.xml` contributing a permission and a `consumer-rules.pro`, and
**AGP merges them**. So: emit what each platform's own merger understands rather
than reimplementing merging.

| platform | fragment | cost of forgetting |
| --- | --- | --- |
| Android | `AndroidManifest.xml`, `consumer-rules.pro` | a missing `POST_NOTIFICATIONS` is a **silent no-op at run time** |
| iOS / macOS | `Info.plist`, entitlements | a missing background mode fails **App Review**, not the build |
| Windows | `.appxmanifest` capabilities | a toast without the capability is dropped |
| Linux | `.desktop`, D-Bus service files | the notification is attributed to nothing |

**One case is open and is not a detail.** `NSFaceIDUsageDescription` is mandatory
on iOS -- an app calling Face ID without it is *terminated by the system* -- but
the string is the consumer's to write. A package can supply the key and not the
value. Whether a merged fragment can **demand** a value, rather than silently
ship a placeholder into a shipping app, is undecided, and it fails in review
rather than in CI.

## 6c. Platform package managers: consume the resolved output

`runtime/jvm/web-platform/android/dependencies.tsv` states the rule better than
a design document would:

> A version range or a `+` would make the artifact that ships differ from the
> artifact that was reviewed, which is the whole of a supply-chain problem in one
> line.

So: **take each ecosystem's resolved output, pin it with digests, never drive the
resolver.** A Gradle or Maven classpath, `Package.resolved`, `Podfile.lock`,
`pkg-config --libs`. We do not parse `build.gradle` -- a Turing-complete program
-- any more than we parse a Makefile. This is §5's rule about configs, one layer
out: read what was resolved, not the thing that resolves.

The **reverse** direction is unanswered and is a separate piece of work:
*emitting* a Gradle module, an SPM package or a podspec so an existing native
project can consume us. `runtime/jvm/web-platform/android/build.gradle.kts` is a
hand-written instance, which suggests the shape is known and not generalised.

## 6d. How far the non-C, non-Java platforms actually are

The fixture writes Apple in Swift and Windows in WinRT, and the three distances
differ in a way "we bind C and class files" hides:

- **Swift is near.** `swiftc -emit-objc-header` produces a C/ObjC header we
  already read, and `.swiftinterface` carries the module surface. `swift:` is
  sugar over a generated C surface rather than a second binding mechanism.
- **WinRT is nearer than it looks.** `.winmd` is **ECMA-335 metadata**, so
  `compiler/jvm-emitter`'s class reader is the shape that transfers -- a metadata
  reader over a specified binary format producing declarations. What does *not*
  transfer is the call: WinRT is COM underneath, a vtable and an `HSTRING`, not a
  JNI-style bridge. The types are the easy half.
- **Objective-C** sits behind Swift and is reachable the same way.

## 6e. Audit: every field, against what exists

`tooling/config` was written 2026-08-26 from RFC §6 and §34 and never revised.
Pointing 19 real configs at it produced 52 type errors, and reading each one
produced this. **47 exported names became 26.**

The test applied throughout, because "delete what has no reader" would delete
everything -- *nothing* reads `nts.config.ts*, not one field:

> Remove what is **derivable**, what names a **mechanism that does not exist**,
> and what is a **`string` standing in for a decision nobody has made**.

### Removed

| what | why | evidence |
| --- | --- | --- |
| `runtime.family` | derivable | `"native" \| "jvm"` is decided by `target.backend`. `family: "native"` beside `target.android()` typechecked |
| `memory.mmtk()` | no mechanism | `compiler/memory-lowering/src/lib.rs`: "experimental, gated behind RFC §3.7. **Not in this crate yet**" |
| `memory.hostGC()` | not a provider | `hir::Provider` is `NoGc \| ReferenceCounting`. The JVM lane reaches "no retains, no releases" by compiling under `NoGc`; there was never a third thing |
| `cycleCollection: "deferred" \| "incremental"` | no mechanism | the word appears nowhere in `memory-lowering`, `hir/rc.rs` or `runtime/c` |
| the whole `memory` module, and `runtime` on products | not a product choice | the provider is a **`--rc` flag** (`tooling/cli/src/main.rs`), and `hir::Provider`'s own doc says `NoGc` is "never a silent default for an application". One value is the only shippable one, so it is a build mode, not configuration |
| `runtimeLinkage` | no mechanism, borrowed vocabulary | nothing implements shading or relocation -- the three `relocat` hits are slot relocation and refusal text -- and there is **no jar target at all**. The only `--jar` is `nts bind` *reading* one. For a jar the words are "shaded" or "declared" anyway, not `bundled-private` |
| `host` / `HostSpec` / `HostEnvironment` | untyped placeholder | five bare `string`s, so `host.android({ fetch: "banana" })` typechecked, and nothing read any of them. `ui` is a *rendering* choice rather than a host service, which is why it read oddly as a host property |
| `profiles: ApiProfile[]` | no mechanism | nine profiles; the compiler has no notion of one |
| `debug: DebugProfile` | no mechanism | five levels; nothing emits them |
| `RuntimeFamily` | orphan | the type behind the deleted field, which outlived it |
| six of ten `ProductKind` values | unconstructible | `framework`, `android-library`, `native-ui-sdk`, `host-surface-library`, `chromium-shell`, `module-package` were declared and unreachable. The union was referenced by **nothing, not even inside its own file** |

**The host axis is real and its absence is deliberate.** iOS and macOS share a
backend, a memory strategy and most of a native surface, and differ in exactly
this. It is carried by the constructor -- `app.ios` is UIKit because it is
`app.ios` -- and comes back when something consumes it, with values instead of
strings.

### Kept, and buildable today

| field | how |
| --- | --- |
| `entry` | `--entry` takes a comma-separated list (`requested_entry`) |
| `exports` | `hir::reachable::Roots::Entry`; `reachability.rs` tests naming fewer than the source exports, and naming one it does not. **Now optional** -- see below |
| `target` / `targets`, `backend`, `arch` | `Backend` is `hir`'s three, and `NTS_BACKEND` selects one |
| `tsconfig` | the CLI takes a tsconfig path; now **defaults** to `./tsconfig.json` |

### Kept, and not buildable yet

Each names a decision that exists, with an artifact that does not. `emit-jvm
--out` writes loose class files; `emit-c --napi` is the only real library
artifact in the list.

`kind` beyond `node-addon`; `javaPackage` (`nts.gen` is the documented gap);
`soname`, `header`, `pkgConfig`, `importLibrary`, `moduleDefinition`;
`apiVersion` and `platforms`; `consumerProguard`; `moduleName`; `native`,
`manifests`, `dependencies`, `integrate`; `build.cache`; `workspace.packages`
and `tsconfigBase`.

### `exports` was a duplicate in eight of eight

Checked rather than assumed: every library config in the fixture declared
`exports`, and in **all eight** the list was character-identical to the entry
module's exports. Not one narrowed anything. A second statement of one fact,
agreeing today, with nothing keeping it agreeing.

It is now **optional, defaulting to the entry's exports**, and is documented as
a *narrower*: naming fewer shrinks the ABI and the binary, because it becomes
`Roots::Entry` and the rest stops being a root. It earns its place only where
the entry is a barrel re-exporting more than the artifact should carry.

Where it disagrees with the source and is *wider*, the source is what to change
-- an `export` that should not be public is a missing keyword, not a config
entry. That is clearest on a Node addon, where the artifact's surface is
literally the module's exports and there is no visibility mechanism underneath
for a config to select from.

`examples/library`'s whole product is now `library.linux({ entry })`.

### What the audit is really about

None of this is a criticism of the RFC. It is day-one text and says so. What it
shows is a failure mode specific to a *typed* proposal: `ProductKind` reads as
"these are the ten things we build", `memory.mmtk({ plan, minHeap, maxHeap })`
reads as a tuned collector, and `host.android({ ui: "android-views" })` reads as
a configured host. Prose that claimed those things would be obviously
aspirational. **In a type it reads as capability**, and it survived twenty days
and one fixture written against it before anything checked.

The check now exists: `examples/workspace/tsconfig.configs.json` typechecks 19
configs against the package, and it is the first thing in this repository to
typecheck an `nts.config.ts` at all -- `examples/library`'s resolved to stale
built declarations and passed while describing an API that had changed.

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
