# A workspace shaped like a real one

**This is a design fixture, not a buildable project.** Nothing here compiles
today, and much of it names capability this compiler does not have. It exists so
the build system is argued against a concrete tree instead of against a config
snippet -- which is how the previous round of this design went wrong, by being
written from inside one lane.

It is deliberately **not** a pnpm workspace yet: no `pnpm-workspace.yaml`, no
`package.json`, no dependencies. Those decisions come after the shape is agreed,
not before.

## It is invisible to the gate, on purpose

The gate's example globs are `examples/*/tsconfig.json`, **depth one**, and this
directory has no `tsconfig.json` at its root -- the same reason
`examples/interop/<name>/` has never been in the 205. `nts-suite` reads
`third_party/typescript-go/testdata/`, not here. The interop step globs
`examples/interop/*/build.sh`, and nothing here is under `interop`. Checked
before this directory was created, because a fixture that silently joins a
floor is worse than no fixture.

If any of that changes, this directory becomes 40-odd new corpus entries that
nobody meant to add.

## The config package, rewritten

`@nts/config` lives at `tooling/config/` and **every config in this fixture
typechecks against it** -- `tsconfig.configs.json` beside this file is the check,
and it is the first time any `nts.config.ts` in this repository was typechecked
at all. `examples/library`'s one resolved through a project reference to *stale
built declarations*, so it passed while describing an API that had changed.

The previous version was written 2026-08-26 and never revised -- three commits
touch it: the one that created it, a test removal, and the restore of the
1121-file deletion. Nothing read it then and nothing reads it now: no Rust loads
`nts.config.ts`, and the two mentions in `hir/reachable.rs` are comments about
what `exports:` is *for*. It was a typed proposal with no consumer, and this
fixture is what argued with it.

What it already had right is kept: `products` as a **record**, so the key is the
product's identity and uniqueness is by construction; builders returning **plain
data**, which is what lets a resolved config be hashed; and `Target` composed
rather than selected from presets, which is RFC §6's argument.

What changed, and every item came from writing a config against it:

- **Every `ProductKind` is now constructible.** It listed ten and permitted
  three, so `framework`, `android-library` and four others were declared and
  unreachable -- which is why this fixture reached for `kind: "aar"` before the
  rewrite. The kinds are now `aar`, `jar`, `xcframework`, `shared-library`,
  `static-library`, `node-addon`, `application`, `executable`, and each has a
  constructor that produces it.
- **Constructors are per target.** `library.android` takes `javaPackage` and no
  `soname`; `library.linux` takes `soname` and no `javaPackage`. Checked both
  ways: a valid Android library typechecks, and the same with `soname` added
  fails by name. The invalid combinations stopped being *sayable* rather than
  being caught later.
- **`tsconfig` defaults** to `./tsconfig.json` beside the config. Every config
  here used to write that string; `examples/library` no longer does.
- **`host` and `debug` have builders.** `host.ios()` and `host.macos()` differ in
  scheduler and surface, which is the axis those two apps exist to separate.
- **Packages speak in target *ids*, products in `Target`s.** A package declaring
  `["android-29", "ios-17"]` is making a claim, not composing a build -- and the
  id is what names the prelude package and keys the cache.

## Project references carry the dependency graph

Every package is a **composite** TypeScript project and every app **references**
the packages it imports. `tsconfig.solution.json` at the root references all
thirteen, so `tsc -b` builds them in dependency order.

That placement is the point rather than a convenience: **the graph lives in
tsconfig, because tsconfig is the source of truth.** `nts.config.ts` says what
gets *built* -- targets, backends, hosts, native source roots -- and says nothing
about which packages a program is made of. The two files cannot disagree about
the graph because only one of them describes it.

Two consequences worth knowing before editing:

- **Composite projects must emit declarations**, so `tsconfig.base.json` does not
  carry `noEmit`. Packages set `emitDeclarationOnly` with an `outDir` of
  `.types/`; apps set `noEmit` themselves. `nts` does the real emitting -- `tsc`
  here only typechecks and publishes `.d.ts` for the graph.
- **The solution file is `tsconfig.solution.json`, not `tsconfig.json`**, and
  that is a constraint of this repository rather than a preference: the gate
  globs `examples/*/tsconfig.json` at depth one, so the idiomatic name would
  enrol this fixture in the 205. Anyone "fixing" the name adds 40-odd corpus
  entries by accident.

## The three axes, made concrete

| axis | what varies here |
| --- | --- |
| **artifact kind** | `apps/*` produce artifacts; `packages/*` are consumed by them |
| **target** | android, ios, macos, linux, windows, node, plain-native |
| **backend** | JVM for android; LLVM for apple/linux/windows; C for node and native |

`apps/react` is the one that crosses: **one entry, four targets**.

## apps/

| app | target | backend | what it exercises |
| --- | --- | --- | --- |
| `android` | android-29 | jvm | JVM backend, Android host, a package with Java in it |
| `ios` | ios-17 | llvm | LLVM + triple + UIKit host; C-level native interop |
| `macos` | macos-14 | llvm | same backend, different host -- proves host is its own axis |
| `linux` | linux-gnu | llvm | GTK host |
| `windows` | windows | llvm | a target with no POSIX |
| `node` | node-addon | c | `emit-c --napi`; the only app that is a *library* to its host |
| `native` | linux-gnu | c | a plain CLI executable, no UI host at all |
| `react` | android, ios, macos, windows | jvm + llvm | **one product, four targets**, two backends |

`node` and `native` share a target family and differ in artifact kind, which is
the pair that shows why those two axes cannot be merged.

## apps/*-brownfield: an existing app consumes us

Everything above is greenfield -- nts builds the app. **These seven invert it:**
the app already exists, already ships, and is not being rewritten. We are a
dependency it adds, ideally in one line of a file somebody else owns.

That inversion changes what a product *is*. `products` becomes a `library`, not
an `app`; `exports` stops being packaging and becomes the public API; our
manifest fragments merge into *their* manifest; and the artifact has to be
something **their** resolver understands.

| app | their build | artifact we owe | what this one forces that no other does |
| --- | --- | --- | --- |
| `android-brownfield` | Gradle | **AAR** | consumer ProGuard rules, and manifest merging that actually works |
| `ios-brownfield` | SwiftPM | **XCFramework** | a module map to `import`; **Info.plist cannot merge** |
| `macos-brownfield` | CocoaPods | XCFramework / `.dylib` | signing, notarisation, hardened runtime -- constraints on *compiler output* |
| `linux-brownfield` | CMake | `.so` + `.pc` | versioned soname, symbol visibility, no package manager at all |
| `windows-brownfield` | MSBuild | `.dll` **and** `.lib` | the import library is a second artifact; NuGet against vcpkg |
| `node-brownfield` | npm | `.node` per platform | five binaries, and Node-API version pinning |
| `java-desktop-brownfield` | Maven | jar | the easiest to ship to, and `nts.gen` makes it unacceptable today |

### The host owns `src/`, and we are the guest

The first version of these seven put our TypeScript in `src/` -- and every one
of the host ecosystems already owns that directory. `src/main.cpp` beside
`src/sdk.ts` in the CMake and MSBuild apps; `src/server.mjs` beside it in the
npm one; and in the Maven app our file sat *inside* `src/`, which Maven treats as
its own tree.

So the rule, and it only appears in brownfield:

> **A greenfield app owns its layout and keeps `src/`. A brownfield app yields
> it, and our sources live in `nts/`.**

`apps/android/src/main.ts` and `apps/android-brownfield/nts/sdk.ts` are the pair
that shows it. There is no host in the first case to yield to.

**Android is the one host with room for us inside its own conventions.** Gradle
`sourceSets` takes extra source directories, so `src/main/ts` would be idiomatic
there -- `runtime/jvm/web-platform/android/build.gradle.kts` already does this
for `src/android/java`. It is noted in that app's build file and not taken,
because the other six have no equivalent notion and the asymmetry is worth
seeing rather than smoothing over: Android can absorb us, CMake cannot.

### And each host project has to be valid by its own rules

A second error, distinct from the first and found the same way:

- `android-brownfield` had `app/build.gradle.kts` and **no `settings.gradle.kts`**
  -- a Gradle module in no Gradle project, which is not a shape that exists. Now
  a single-module project, which is the smaller of the two normal answers; the
  other is a root plus `app/` plus our module beside it, and
  `runtime/jvm/web-platform/android/` is an instance of that one.
- `ios-brownfield`'s `Package.swift` declared `.target(name: "AcmeApp")` while
  the sources sat in `App/`. SwiftPM looks in `Sources/AcmeApp/`, so the manifest
  described a target that did not exist.
- `macos-brownfield` has a `Podfile` and no `.xcodeproj`, which is not a project
  CocoaPods can integrate into. That one is *not* fixed -- see its README -- and
  is named rather than papered over.

A fixture that is wrong about the host's own conventions cannot be used to argue
about the host, which is the only thing it is for.

### What the set is for

Each one is chosen because it forces something the others do not, and reading
them together says more than any of them alone:

- **Two ecosystems have two resolvers each**, and shipping for one leaves half
  the consumers unable to adopt: SwiftPM against CocoaPods on Apple, NuGet
  against vcpkg on Windows. That is a packaging requirement, not a preference.
- **Only Android has a manifest merger.** `packages/notifications` ships an
  `Info.plist` fragment that nothing merges, and `ios-brownfield/App/Info.plist`
  is where a consumer copies it by hand. The asymmetry is the platform's, but
  the design has to survive it.
- **Windows splits the artifact in two.** A `.dll` without its import library is
  unlinkable, and a library emitting one of the two fails in the consumer's
  project rather than in ours.
- **Node multiplies it by platform.** One `.node` is five binaries before musl,
  and Node-API pinning is the only thing keeping that from being five *per Node
  major*.
- **Linux has no resolver**, so `pkg-config` and a versioned soname are the whole
  distribution story, and a hard-coded path is how a library stops being
  redistributable.
- **The JVM is the easiest to ship to** and the hardest backend to have built --
  which is worth noticing, because effort spent on a backend does not predict
  effort spent on packaging its output.

The common thread is the item `docs/nts-config.md` §6c names as unanswered:
consuming a package manager's resolved output is one problem, and **emitting
something it resolves** is a different one. All seven of these need the second,
and `emit-jvm --out` writing a directory of class files is not it.

## packages/

Chosen for the combinations they force, not for coverage.

| package | native? | targets | needs `nts.config.ts`? |
| --- | --- | --- | --- |
| `storage` | no | all | **no** -- the case that proves the rule |
| `telemetry` | no | all | **no**, but its surface diverges per platform |
| `crypto-core` | C only | all | yes -- one C implementation, no per-platform split |
| `biometrics` | Java, Swift | android, ios **only** | yes -- a strict subset of targets |
| `notifications` | Java, Swift, C, WinRT | all five | yes -- the showcase |

**Two of five need no config**, which is the rule from `docs/nts-config.md`
made visible: *a config file is required exactly where there is a build step.*
`storage` and `telemetry` are ordinary TypeScript and get their type environment
from `types: [...]` in their own `tsconfig.json`.

### Why each one is here

**`storage`** -- pure TypeScript, no native, no config. If this package ever
needs an `nts.config.ts`, the rule has broken.

**`telemetry`** -- pure TypeScript, and *still* platform-sensitive: it wants a
monotonic clock, which is a different API on every platform. It has no native
code, so it resolves that through the platform type surfaces alone. This is the
package that makes the **intersection** question concrete: it is written once
and must typecheck against every target its consumers use.

**`crypto-core`** -- one C implementation, no per-platform variants. The simplest
native case, and the one that shows a package can have native code without
having five copies of it.

**`biometrics`** -- android and iOS only. A desktop app depending on it must
fail **at configuration time** with a readable reason, not at link time. This is
the package that asks what a target set *means* when a dependency does not
share it.

**`notifications`** -- the showcase, and the reason this fixture exists:

- **generic TypeScript** (`src/index.ts`) -- the API a consumer sees, with no
  platform in it;
- **per-platform TypeScript** (`src/android.ts`, `src/apple.ts`, ...) -- each
  importing that platform's bindings;
- **per-platform native, in that platform's real language** -- Java for Android,
  Swift for Apple, C for Linux, WinRT for Windows;
- **and a callback**, because a notification tap has to reach a TypeScript
  handler.

That last point is the hard one. `docs/nts-config.md` §6 records the ordering
cycle: TypeScript-calls-native needs bindings generated before the TypeScript is
checked, and native-calls-TypeScript needs the emitted artefacts before the
native compiles. `notifications` needs both, in one package, which is why its
config declares a direction per source root rather than letting one be inferred.

## Two config fields were removed, and the removals are the design

The first version of `notifications/nts.config.ts` had `language` and
`direction` on every source root. Both are gone.

**`language` is derivable** from the extension -- `.java`, `.kt`, `.swift`,
`.cs`, `.c`, `.m` -- and a directory may legitimately hold two, since `.java`
beside `.kt` is ordinary and both become class files. Declaring it made the
config a second derivation of something the filesystem already says.

**`direction` was the wrong shape, and this fixture is the proof.** The previous
version declared `native/android/...` **twice**, once per direction, because
`Scheduler.java` is called by TypeScript *and* calls back into it. A directory
that has to appear twice is not described by that field: direction is a property
of edges, not of roots.

It is inferred instead, the way mutual recursion always is -- declarations before
bodies: read native declarations and bind them, typecheck TypeScript and emit,
then compile native bodies against both. That works here because `setTapHandler`
takes an opaque handle. Where a native signature *names* a type we generate the
cycle is real, and it is detectable at the first step; the honest answers are a
two-phase compile or a refusal naming the signature. Neither is a field a user
should have to write.

## What a package contributes besides code

Precedent is already in this tree, and it decided the approach:
`runtime/jvm/web-platform/android/` ships an `AndroidManifest.xml` contributing
`<uses-permission android:name="android.permission.INTERNET" />` and a
`consumer-rules.pro`, and **AGP merges them**. So we should not reimplement
manifest merging; we should emit something each platform's own merger
understands.

| platform | fragment | what it costs to forget |
| --- | --- | --- |
| Android | `AndroidManifest.xml`, `consumer-rules.pro` | `POST_NOTIFICATIONS` missing is a *silent no-op* at run time |
| iOS / macOS | `Info.plist`, entitlements | the iOS background mode missing fails App Review, not the build |
| Windows | `.appxmanifest` capabilities | a toast without the capability is dropped |
| Linux | `.desktop`, D-Bus service files | the notification is attributed to nothing |

`biometrics` poses the question the others do not: `NSFaceIDUsageDescription` is
**mandatory** on iOS -- an app calling Face ID without it is terminated by the
system -- but the string is the consumer's to write. So its fragment supplies a
key with a placeholder and marks it `requiresValue`. Whether a merged fragment
can *demand* a value rather than silently ship a placeholder into a shipping app
is open, and it is the kind of thing that is discovered in review rather than in
CI.

## Platform package managers: consume the resolved output, pin it

`runtime/jvm/web-platform/android/dependencies.tsv` already takes this position
and states it better than a design doc would:

> A version range or a `+` would make the artifact that ships differ from the
> artifact that was reviewed, which is the whole of a supply-chain problem in one
> line.

So the rule is: **take each ecosystem's resolved output, record exact versions
with digests, and never drive the resolver.** A Gradle or Maven classpath,
`Package.resolved`, `Podfile.lock`, `pkg-config --libs`. We do not parse
`build.gradle` -- it is a Turing-complete program -- any more than we parse a
Makefile. This is the same rule as "read the resolved config, not the config
source", one layer out.

The reverse direction is separate and unanswered: **emitting** a Gradle module,
an SPM package or a podspec so an existing native project can consume *us*.
`runtime/jvm/web-platform/android/build.gradle.kts` is a hand-written instance of
exactly that, which suggests the shape is known and not generalised.

## What this fixture is honest about not having

- **Swift, Objective-C and WinRT support.** `native/apple/*.swift` and
  `native/windows/*.cs` are written as they really would be, and this compiler
  binds none of it today. Two different distances, worth separating: Swift is
  near, because `swiftc -emit-objc-header` produces a header we already read, so
  `swift:` is sugar over a generated C surface. **WinRT is nearer than it looks**
  -- `.winmd` is ECMA-335 metadata, so `compiler/jvm-emitter`'s class reader is
  the shape that transfers -- but its calling convention is COM, which is not.
- **Manifest merging, dependency locking, and package-manager emission.** The
  fragments and lockfiles here are inert files with no reader.
- **AARs, app bundles, `.dylib`, Windows packages.** Produced by nothing today.
  Jars and test APKs come from shell scripts.
- **React.** `apps/react` names a planned feature and carries no dependency.
- **Anything actually building.** No `package.json`, no lockfile, no
  `pnpm-workspace.yaml`.
