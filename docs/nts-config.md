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

**This section was three paragraphs of "produced by nothing at all" for longer
than it was true, which is the hazard a document like this has instead of a
failing test.** Rewritten 2026-09-16 against `tooling/cli/tests/build.rs`, which
is where each claim below is asserted.

- Three backends, `Backend::{C, Llvm, Jvm}`.
- **`nts build` produces every product kind but one**, from the config, with no
  other command: `shared-library`, `static-library`, `executable` and
  `application` on C; a **Node addon**; a `jar`; an `aar`; a **signed,
  installable APK**; and a **runnable jar** for a desktop JVM target, whose
  entry is module evaluation because that is what an executable's entry is on
  the C lane too.
- `xcframework` is the one that is not, and it refuses by name saying which
  Apple tools it would need. A missing Android SDK, a missing component, a
  stale `ANDROID_HOME`, a product with no `id`, a JVM native root holding no
  `.java`, and a package manifest fragment that would be silently dropped are
  each one message naming the thing and the fix.
- A package's **Java is compiled into the artifact** -- a JVM target's `native:`
  roots are Java, and they are the half the program calls into.
- All 16 `examples/interop/*/build.sh` build their product with one `nts build`.
  What toolchain invocations remain in them compile *consumers* -- a C caller, a
  Java driver -- or guard on a tool being installed.

The assertions are about artifacts rather than exit status, because the failures
here are quiet: `aapt2` writes a container whether or not a dex was added, and
`javac` writes classes into the output directory whether or not anything
packages them. So the APK is read back through `apksigner verify` and `aapt2
dump badging`, the contributed Java through the jar's listing, and the shared
library through `nm`.

### Measured: does `zig cc` substitute for `clang`

Asked because assuming either way is expensive, and answered on **this
compiler's generated C** rather than on zig's own claims -- which is not the
same question, and is the one that decides anything.

`zig cc` is a drop-in on the host: `examples/library` builds the same artifact
through `CC=clang` and `CC="zig cc"`. Cross-compiling `program.c` and
`nts_runtime.c`, with `file` reading the result:

| target | result |
| --- | --- |
| `x86_64-windows-gnu` | PE32+ executable for MS Windows (DLL) |
| `x86_64-linux-musl` | ELF 64-bit LSB shared object |
| `aarch64-linux-gnu` | ELF 64-bit LSB shared object, ARM aarch64 |
| `aarch64-macos-none` | **FAILED** -- `unknown type name 'malloc_zone_t'` |

So Apple is the one it cannot reach: the runtime includes headers that come from
Apple's SDK rather than from zig's bundled libc, and no flag fixes that. It is
refused by name with that reason rather than attempted, because the alternative
is a page of `unknown type name` from a tool the reader did not invoke.

**What this was hiding.** `link_c` never read `target.os` and `artifact_name`
hardcoded `.so`, so a `windows` product built on Linux produced `libsdk.so` -- an
ELF shared object under a Linux name, for a platform that loads neither. Nothing
saw it because `target.windows()` was pinned to the llvm backend, which refuses
before reaching a linker: a bug kept alive by an unrelated refusal, which is the
second one of those this week.

### Built, and the price was 42 rather than 3: `javaPackage`

`nts.gen` is hardcoded in the JVM emitter and `package_jvm` refuses a jar whose
config asks for anything else, rather than shipping classes somewhere other than
where the declaration says. Two fixtures sit behind it --
`apps/android-brownfield` and `apps/java-desktop-brownfield`, both asking for
`com.acme.sdk` -- and the fixture's own comment says why it matters: "`nts.gen`
is the current fixed name and is wrong for a shipped library".

**The surface was measured rather than estimated, by making the change and
letting the compiler count.** Parameterising `symbols::jvm_class_name` breaks
**3** sites, all in `codegen/jvm/src/types.rs`. But the two functions there --
`class_name` and `identity_class_name` -- have **42** callers across five files,
and they take a `&Layout` rather than anything program-wide, so the package has
to arrive as a new argument at every one of them.

That is mechanical rather than hard, and it is not small. The alternatives that
avoid it are worse: a thread-local is undeclared state a pass would rest on, and
rewriting the package in finished class bytes means patching constant-pool UTF8
entries after the fact. The shape that would make it cheap is the package
reaching those two functions on something already threaded -- which is a change
to what `class_name` takes, and therefore the same 42 sites.

Estimated at 3 sites before the probe and measured at 42, which is the reason to
run the probe rather than reason about the seam.

**Built afterwards, and the count was right.** `types::Shape` carries the
package -- it is already "the program plus the one whole-program fact that
changes a type's spelling", and a package is exactly that -- so the fifteen
sites in `ops.rs` came free through `self.shape` and the rest arrived as a
parameter.

Two things the compiler could not have told me. `widen.rs` builds a
`(class, field)` key that *looks* pass-internal and is not: `ops.rs` asks
`widened_fields.contains(&(types::class_name(..), name))`, so a key spelled any
other way answers `false` for every field and the widening silently stops
happening. And the last name still hardcoded was the program class itself,
which showed up as a jar holding `com/acme/sdk/Counter.class` beside
`nts/gen/Program.class` -- half the program in each package. Then, with the
paths right, a stale `invokestatic` still threw `NoClassDefFoundError:
nts/gen/Program`: **listing an archive says nothing about the names inside the
bytecode**, so the test compiles and runs a Java consumer against the jar.

**The default backend was the refusal.** `target.linux()` defaulted to `llvm`
and `ios`, `macos` and `windows` were pinned to it, while `app.linux({ backend })`
defaulted to `c` -- two answers to one question, disagreeing, and the one that
lost cannot write a program. `examples/library` carried a comment about saying
`backend: "c"` out loud, which is what a broken default looks like from inside a
config: the workaround gets written down instead of the default getting fixed.
All of them now read one `NATIVE_DEFAULT`, which is `c` because that is the
backend that produces an artifact, and moves when the llvm lane grows an `--out`.

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

`examples/library`'s whole product is now
`library.native({ targets: [target.linux()], entry })`.

### An XCFramework is not the Apple `.so`, and the artifact is chosen by consumption

The constructors were per *platform* -- `library.linux`, `library.windows`,
`library.macos`, `library.ios` -- and two of those encoded a mistake.

**Three Apple things get collapsed by the name and are not the same:**

    .dylib          the shared library itself -- this is what `.so` is
    .framework      a bundle: that binary plus headers, a module map, Info.plist
    .xcframework    several frameworks, one slice per platform *and* environment

**XCFramework exists for a problem `.so` does not have.** A universal binary
cannot hold both an `arm64` iOS *device* slice and an `arm64` iOS *simulator*
slice: same architecture, different platform triple, and `lipo` has nowhere to
put the distinction. The `.xcframework` is the container that can.

So `library.macos` always producing one was wrong. A macOS program linking with
clang or CMake wants a `.dylib` and a header -- *identical in shape to Linux*.
Only an Xcode consumer (a SwiftPM `binaryTarget`, CocoaPods
`vendored_frameworks`, an app embedding it) wants the XCFramework.

The constructors now split by **how the artifact is consumed**:

    library.native({ targets: [linux, macos, windows] })   .so / .dylib / .dll
    library.xcframework({ targets: [ios, macos] })          Apple distribution

`library.native` is one constructor over several targets because those three are
one *kind* of artifact with different packaging, not three kinds. And what
differs between them turned out to be derived rather than configured, which is
this audit's recurring shape:

- **the import library** on Windows is always emitted -- a `.dll` without its
  `.lib` cannot be linked against, so it was never a choice;
- **the `.pc`** on unix is always emitted, because a consumer who cannot find the
  library hard-codes a path, and a hard-coded path is how a library stops being
  redistributable;
- **`moduleDefinition` is gone entirely.** A `.def` is a second way to say which
  symbols are exported, and we generate the code -- the list is `exports`, and
  two spellings of it is the duplicate that field had just lost.

`soname` survives as an **override** for a library that must match a name it did
not choose; the default derives from the product name and version.

The fixture shows the consequence: `macos-brownfield` uses `library.xcframework`
because it ships through CocoaPods, and that now reads as a decision rather than
as what macOS happens to produce.

### Audited by an instrument, and it found what reading had not

The three rounds above were read out of the source by hand. This one is
`tooling/config/audit.mjs`, a gate step: it evaluates every `nts.config.ts` in
the tree against the package that defines it, builds the fixture's program, and
asks eleven questions whose answers depend on the input. Every question that
reports nothing has been shown to fire on a mutation -- one of them on a
*discriminating pair*, where a package claiming `android-30` is a finding and the
same claim at `android-29` is not.

It was worth building because reading found the fields and missed the facts.

**The id conflated an SDK with a deployment floor.** `target.ios({
minimumVersion: "17.0" })` produced `ios-17.0`; every package declared
`"ios-17"`; the two never intersected. So the configuration check those packages
exist to demand -- fail by name rather than at link time with a missing symbol --
would have rejected every iOS app in the fixture, over a string compare, for a
version both sides agree about.

Dropping the minor fixes the symptom. The cause is that **the SDK you compile
against and the oldest OS you run on are different numbers on every platform
here**: Xcode builds against the iOS 18 SDK with a deployment target of 15.0,
Gradle pairs `compileSdk` with a lower `minSdk`. The surface belongs to the id
because that is where the types come from; the floor belongs to `minimumVersion`
because that is what the linker and the manifest are told. Both are now accepted
and the second defaults to the first.

Then the fix exposed a second conflation one level up. With `apps/android` saying
`compileSdk: 36` out loud, the audit reported that no package claims
`android-36` -- correctly, and it is not a defect. **Id equality is the wrong
satisfaction rule.** A package declaring `"android-29"` is claiming it needs API
29 *at run time*, and an app compiled against 36 with a `minSdk` of 29 satisfies
it. So a claim is compared by family, and its version against the consumer's
floor.

**That paragraph was true of the audit and false of the build for as long as it
took to build an APK.** `NativeSources::covers` and `Manifest::covers` were both
`it == id`, so `nts build examples/workspace/apps/android` produced two signed,
installable APKs carrying neither `notifications`' Java nor `biometrics`'
`USE_BIOMETRIC` permission, and reported nothing about either -- while
`apps/android-brownfield`, which differs in one word (no `compileSdk`, so its id
is `android-29`), refused by name on the same package. Two arms, one word apart,
and the silent one is the *recommended* Android configuration.

The rule was written down here and the code was a second derivation of it that
disagreed, which is the failure this document exists to prevent. Both now route
through `nts_build::config::claim_covers`, and the second thing that fixing it
exposed is that **the floor is not the surface**: an app with `compileSdk: 36`
and `minSdk: 21` is a real configuration where a claim of `android-29` is *not*
satisfied, and the first implementation compared against the id and said it was.
That case is `the_claim_is_measured_against_the_floor_and_not_the_surface`, and
nothing else in the suite separates the two readings.

**`Integration` was covered 0 of 6, and the first instrument said 2 of 6.** It
collected every string in every config into one bag, and `"gradle"` and
`"swiftpm"` are `Resolver` members too -- so one union's coverage answered for
another's. Coverage is now read from the field each union is written in. The
six build-system hooks, and the whole `integrate` field, were set by no fixture
at all; the seven brownfield apps are exactly the consumers that need them, and
now declare one each.

**The fixture's program sources had never typechecked.** Nothing had run `tsc -b
tsconfig.solution.json`, and it failed on every project: `baseUrl` is removed in
TypeScript 7, and five `types: ["@nts/platform-*"]` entries named surface
packages that existed nowhere in the tree. The earlier rounds reported the
configs CLEAN and were right about the configs -- a measurement's population is
part of its claim. The surfaces are now placeholder packages under
`types/@nts/`, deliberately empty rather than sketched, because a surface with
three invented declarations is a claim about an API nobody has read.

Five errors remain and are counted rather than fixed: `c:digest`,
`c:notifications`, `java:com.example.notifications`, `swift:Notifications`,
`winrt:Example.Notifications`. Those are the binding modules the compiler
generates from `native: [...]`, and they cannot resolve before `nts` runs. That
is the build order the `integrate` hooks exist to enforce -- bind, typecheck,
emit, then compile the native bodies -- so it is a fact about the pipeline rather
than a defect, and the audit fails on any error that is not one of them.

It was seven, and the two that went were not bindings at all. **`c:types` was
unresolved because the platform surfaces were empty and `crypto-core` named
none.** The seven modules `runtime/native/libc.d.ts` declares -- `c:types`,
`c:memory`, `c:stdint`, `c:stddef`, `c:stdbool`, `c:stdlib`, `c:math` -- are
standard C rather than anything glibc-specific, so every platform here has them
and each surface package now references the file that already ships. Inventing a
second copy would have been the duplicate this document keeps deleting.

`crypto-core`'s tsconfig named no surfaces while its config claimed six targets,
which is the same disagreement one level up: the config says what a package
supports and the tsconfig decides what its program is, and those two had never
been made to agree for that package.

So the unresolved set is now exactly "what `nts bind` would generate", which is
the honest statement of the gap rather than a mixture of that and a fixture
oversight.

#### What the coverage questions turned up

- **`static-library` was constructible and nothing built one**, so nothing had
  ever checked that it differs from a shared library only in packaging.
  `apps/linux-brownfield` now ships both, which is what a real C SDK does.
- **`NativeLibraryProduct` had no way to name its namespace.** An AAR has
  `javaPackage` and an XCFramework has `moduleName`; C has one flat namespace per
  process, so `remember` from two libraries is a silent interposition at load
  rather than a link error. The fixture had this written in a *comment*, as
  something a shared library owes its consumer, and had encoded it in the
  identifiers instead -- `export function acme_remember`. `prefix: "acme_"` is
  the field; the sources dropped the manual prefix and `src/main.cpp` links the
  same symbol.
- **A Node addon said where it runs twice.** `platforms: ["darwin-arm64", ...]`
  was bare strings beside a `targets` field that said x86_64 -- two spellings of
  one axis, already disagreeing. `apiVersion` moved to the target, because the
  Node-API version *is* the surface, and the machines became targets that share
  it.
- **A manifest fragment could claim two disjoint answers.** `Manifest` had
  `target` beside `targets`, both meant the same axis, and nothing decided which
  won. One field.
- **`exports` was set by nothing**, one round after being relaxed from required
  because eight of eight uses restated the entry's exports. It now has the one
  case it is for and no more: `apps/linux-brownfield` exports `dumpState` because
  its own tests import it, and the ABI publishes two names.
- **Four `lockfile` paths pointed at files that were not there** -- written one
  commit earlier by the fix for `Resolver` coverage. Every path a config names is
  now checked, and the same check found that the workspace root's *default*
  `./tsconfig.json` does not exist: that fixture names its shared settings
  `tsconfig.base.json` on purpose, and a root config declaring only `workspace`
  has no program for the default to point at.
- **`wasm32` was in `Arch`** and reachable only as `target.linux({ arch:
  "wasm32" })`. No backend emits it. `armv7` stayed and is now real:
  `apps/android` ships two ABIs, which is what an APK does.
- **`target.linux({ backend: "jvm" })` typechecked**, producing the id
  `linux-gnu` -- a libc type surface a program on the JVM does not have. The
  native constructors take `NativeBackend`.

**The bare `library()` callable is gone**, and the round it survived is the
argument for the instrument. It was reported called by no fixture and exempted as
an escape hatch -- which sounds right until the question is "needed for what".
Multi-target is already the normal case: `library.native` takes Linux, macOS and
Windows together, `library.xcframework` takes the Apple targets together, and
every `ProductKind` has a constructor. So there was no shape it could express
that a constructor did not express more narrowly, and a callable nobody calls is
the same shape as the `ProductKind` union that named ten kinds and permitted
three. `app()` bare stays, because `apps/react` genuinely needs it: one product,
four targets, two backends, and no per-platform constructor says that.

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

## 6f. The first consumer, and the three defects found on the way to it

Everything above is about the shape of the config. Nothing read one: `grep -rn
"nts\.config" --include="*.rs"` returned two comments in `reachable.rs` and no
code. `exports` had been argued from required to optional, given a documented
default, and audited twice, without ever changing an artifact.

It does now. `nts_build::config` evaluates the file, and a product's **`entry`**
becomes `hir::reachable::Roots::EntrySurface` -- the artifact publishes what that
module exports, and nothing else.

### `exports:` lasted one commit, and removing it was the better fix

It shipped first as a list of names crossing the ABI, wired to `Roots::Entry`.
That was awkward to write and my user said so, which turned out to be the useful
signal: **the field only had a question to answer because a default was wrong.**

`Roots::EveryExport` roots at the `export` keyword in *every* module. That is
right for a TypeScript package a consumer can import any file of, and wider than
anything this compiler emits -- nothing outside a `.so`, a `.node`, a jar or an
`.xcframework` can reach an internal module. So a helper exported for a sibling
stayed a root, and getting it out of the artifact needed a list.

`Roots::EntrySurface` is that default fixed, and then `entry` -- which a product
must name to be built at all -- says the whole thing and cannot disagree with the
source. The fixture shows the shape it asks for: `apps/linux-brownfield` moved
`dumpState` into `nts/internal.ts`, where the entry does not re-export it and the
tests still import it directly. That is where every ecosystem puts a test-only
helper.

Measured on two products differing **only** in their entry:

    --product addon  (entry ./src/main.ts)      onlyPublished published
    --product sdk    (entry ./src/internal.ts)  diagnostic helper onlyDiagnostic

Disjoint surfaces, no list anywhere. `helper` appears in one and not the other
for a second reason worth knowing before reading a root set as evidence: it is a
root in `sdk` and an inlined callee in `addon`, and a trivial function reached
from the entry leaves no definition at all.

**One bug the sweep caught and review would not have.** The first version of the
variant omitted module initialization, and `examples/library` -- which exports
`add` and a module-level `const greeting` -- lost `module__init` and the string
behind it. A two-name library publishing one of them as null: a wrong *answer*,
not a missing symbol. It was found by diffing all 218 examples against a binary
built from the parent commit, not by reading the diff.

### Evaluated, not parsed

The file's contents are function calls -- `library.native({ targets:
[target.linux()], entry })`. Parsing it would mean reimplementing those
constructors in Rust: a second answer to what `target.linux()` produces, in a
different language from the one the user typechecks against. Every round of this
audit has been about deleting that shape, so the real constructors run and the
value they return is read.

Two alternatives were considered for resolving `@nts/config` and both rejected.
Injecting a resolver hook at this repository's copy works here and not in an
installed compiler. Shipping a *runtime* implementation of the constructors
inside `nts` works everywhere and is worse than either -- it is a second
implementation of `library.native`, so the package the user typechecks against
and the one that decides what gets built could disagree.

So node resolves it like any dependency, and the cost is stated rather than
discovered: **node is a config-time dependency of a compiler that is otherwise
Rust.** It is bounded by the config being optional. A project without one never
invokes node, which is every example in this tree but one.

### Three defects in the flag it had to join

The wiring is four lines. Finding out why they could not be written took the rest.

**`emit-c` accepted `--entry` and ignored it.** `emit-llvm` and `emit-jvm` build
options through `emit_options`, which reads `--main` *or* `--entry`; `emit_c` had
the decision written out again and the copy had drifted to `--main` alone. So the
flag parsed, selected nothing, and the output looked like an answer. It matters
here more than anywhere: **a Node addon is the C backend**, and `exports` exists
to narrow exactly that kind of product, so the field could never have reached the
one artifact that is real today.

**There were two `--entry` parsers with different syntax.** `nts hir` took the
first occurrence and split it on commas; the emitters took every occurrence and
split nothing. So `--entry a,b` meant two roots to one command and a single root
named `"a,b"` to the other -- a name no function has, which matches nothing,
which narrows the program to nothing:

    emit-c --entry published              (kept) onlyPublished published
    emit-c --entry published,diagnostic   (kept)

Empty output, exit zero. Both spellings are accepted everywhere now: each was
already in use, neither is wrong, and a flag that silently empties a program is
not a thing to leave.

**`nts hir --prepared --entry X` printed a program no backend receives.** Its
parser never appended module initialization, which the emitters' has appended
since a benchmark answered 32768 against node's 10240 -- five module-level
`const`s left null, five map keys collapsed into one. Measured on a probe with
one module-level `const`:

    hir --prepared                      module#init  present
    hir --prepared --entry published    module#init  absent
    emit-c --entry published            module__init present

`--prepared` exists to show what a backend sees. One parser now, one place that
appends the root.

### What it does, and what it refuses

A flag beats the file, because a flag answers a question about this run. Several
products with no `--product` is an error naming them, not a guess: emitting an
artifact nobody asked for under a name that says otherwise is worse than
stopping. A config that exists and cannot be read stops the build -- the
permissive direction there means a build quietly ignoring the file it was
configured by. And narrowing says so on stderr, because silent narrowing is
indistinguishable from a compiler that lost the function.

Absent is not an error at any step: most projects have no config, a config need
not declare products, and a product need not narrow. Those are three ways of
saying every export is a root, which is what `Roots::EveryExport` already means.

Checked against a binary built from the parent commit, over all 218 examples and
every flag combination `emit-c` takes: zero differing. The only behaviour that
changed is the flag that did nothing.

### Still no consumer

`manifests`, `dependencies` and `integrate` are read by nothing, and
`nts_build::config` deliberately does not deserialize them -- a struct member
that is parsed and never read is the same shape as a config field nothing
reaches. `targets` is deserialized and unused, which is the one exception, and it
is there because the next consumer is target selection.

## 6g. `nts build`

`nts` had seventeen subcommands and none of them built anything. `emit-c` wrote
C, and twenty-two hand-written `build.sh` in this tree each reconstructed the
rest: compile the runtime beside it, link, package. Each could drift from what
the compiler emits, and several carried flags a person had to know.

    $ nts build
    building `hello` for linux-gnu into .nts/build/hello/linux-gnu-x86_64
    nts.config.ts: product `hello` publishes what `./src/main.ts` exports
      .nts/build/hello/linux-gnu-x86_64/libhello.so
    1 artifact(s) under .nts/build

**No flags, because there is nothing left for one to say.** The backend comes
from the target, the shape from the product's kind, the surface from its entry,
and the file name from the product. `--product <name>` picks one where a config
declares several; that is the whole interface.

### What it builds, and what it refuses

| kind | today |
| --- | --- |
| `shared-library` | `.so`, `-fPIC`, version script, self-initialising |
| `static-library` | `.a` through `ar`, same objects |
| `executable`, `application` | linked against the libuv host, on the C backend |
| `node-addon` | `.node`, checked for unresolved symbols, loads in node |
| `jar` | `<name>.jar` plus `nts-runtime.jar` beside it |
| `aar` | **refused**: the container is a zip of `classes.jar`, a manifest and resources |
| `xcframework` | **refused**: needs the Apple toolchain |
| `application` on the JVM | **refused**: an APK needs `aapt2`, `d8`, `apksigner` |

A refusal names the container rather than saying "unsupported", because the
classes and objects *are* emitted -- `nts emit-jvm --out` writes them -- and the
gap is the packaging alone. It happens **before the output directory exists**, so
a build that stops leaves nothing to mistake for a partial result. That is not
hypothetical: an `aar` product built a `.jar`, which Gradle cannot resolve, under
a name nothing gives a reader reason to doubt.

### Four things the flags encode that a person had to know

Each was found by the artifact failing, not by reading.

- **`-fPIC` is not a preference.** `nts_env` is thread-local and the default TLS
  model is local-exec, so a `.so` fails to link at all:
  `relocation R_X86_64_TPOFF32 ... incompatible with -shared`.
- **A version script, not `-fvisibility=hidden`.** The emitted headers carry no
  visibility attributes, so hiding by default would hide the exports too. Without
  one, a two-function library exported **318** symbols -- every internal of the
  runtime and of the vendored dtoa.
- **The script names symbols, and a published name is not one.** It was spelled
  `c_identifier(emitted)` over `public_api` -- a second derivation of something
  `emit` already knew and reports in the header's `/* C symbol: */` comment, and
  the two disagreed in both directions. A program exporting `function stdin` and
  `const stdin_` gets the symbols `stdin_` and `stdin__`, because `c_global`
  yields file scope to the function; the script wrote `stdin_` **twice** and
  never named `stdin__`, so `local: *` hid an exported constant the header went
  on declaring. In the other direction an exported class has no symbol at all, so
  the script said `global: Counter;` -- which `ld` accepts silently, matching
  nothing. `Wrote::published` now comes from `Emitted::exported_symbols`, and
  `-Wl,--no-undefined-version` makes the next such name a link error rather than
  a quiet omission. That flag catches a name nothing answers to; it cannot catch
  a name answering to the *wrong* symbol, which is closed only by there being one
  derivation.
- **An exported class crosses nothing, and the build says so.** `program.h` emits
  its layout, its offsets and its `_Static_assert`s and declares no function,
  because a method takes `NtsObj_X *` and the boundary hands out no way to obtain
  one. Those names are `Emitted::published_without_a_symbol` and a shared-library
  build prints each one. Kept apart from a *refusal*, which is also an export
  with no symbol and is already counted by `Wrote::refused`: one sentence for the
  two would report every refusal twice and leave the class message meaning
  nothing.
- **A library initialises itself.** The version script then hid `module__init`,
  and a library whose consumer cannot run module evaluation answers with a null
  pointer rather than failing to link. A generated `.init_array` entry runs it,
  for `.so` and `.a` and never for an executable, whose `main.c` already does and
  would otherwise evaluate the module twice. Only when there is something to
  evaluate: a program that is only declarations emits no `module__init`, and
  `--no-undefined` caught the reference.
- **`--gc-sections`, with `-ffunction-sections -fdata-sections`.** The numbers are
  `write_standalone`'s own: the Unicode tables cost 81 KB linked whole against
  10 KB stripped, and a `hello` with no Unicode goes 81 KB to 16 KB.

### Two guards, because a linked file is not an artifact

**Unresolved symbols.** `--no-undefined` where it can be used, which is every
shared library. Not a `.node`: it resolves the `napi_` family out of the host
process at load, so those are legitimately unresolved at link time. Addons are
checked after linking instead -- anything undefined, unversioned, and not
`napi_`. That caught a `.node` that linked, exited zero, and died on `require`
with `undefined symbol: nts_napi_set_env`.

**The native witness.** Where a program binds something native, `nts bind-c`'s
witness is compiled before linking. It declares no symbol, includes the real
headers itself, and fails when what `nts` believes about a struct disagrees with
them -- which is a silently wrong answer rather than a link error. Sixteen
`build.sh` do this by hand.

### `native:`, and where each half of a binding already lives

A `c:` module a program imports has no `.d.ts` until one is generated, and
`nts bind-c` needs three things: the module, the header, and the names to bind.
The interop `bind.sh` scripts pass all three by hand, and the obvious move was a
config field for each.

**The specifier is the program's.** `import { digest_step } from "c:digest"` says
which module, and the checker's `TS2307` says which ones failed to resolve and in
which file. A scan of the sources for `from "c:..."` would answer a different
question -- what the text contains -- finding specifiers in comments and missing
nothing being wrong with them.

**The header is the package's**, and the package is the one *above the importing
file* rather than the one the build started in. An app's program contains its
dependencies' sources, so "which config describes this `c:` module" is answered
by where the file is. That also disposes of the rule this nearly shipped with:
`c:notifications` is declared by `scheduler.h`, so the header's stem is not the
module name and never was.

**The names are the import list.** `nts bind-c` binds nothing unless told what --
`--module` alone produces `declare module "c:digest" {}` -- and the program has
named the function already, in the statement a reader looks at anyway. Type-only
imports are separated, because those are records rather than functions.

So `native:` carries what only it knows -- where the C is -- and nothing else.
The build binds, typechecks and emits against the bindings, then compiles the
native bodies: **declarations before bodies**, which is the order this document
and `native.ts`'s own comments argue for, now running rather than described.

A package that declares native code and needs no binding still gets it compiled.
A callback implementation is called from C and imported by nobody, so the roots
are every package the program's files belong to rather than only those a binding
came from.

### The config's first readers

`entry` (the published surface), `kind`, `targets`, `soname`, and `javaPackage`.
That last one's first reader is a **refusal**: `codegen/jvm` hardcodes `nts/gen`,
so a product asking for `com.acme.sdk` is told what it would have got rather than
given a jar whose package is not the one requested.

`native` is read too, for the bindings and the C described above.

`manifests`, `dependencies` and `integrate` are still read by nothing.

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
