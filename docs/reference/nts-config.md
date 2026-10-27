# nts.config.ts

The reference for `nts.config.ts`, the file that says what a project builds:
its products (executables, libraries, addons, jars, AARs, APKs), the targets
each is built for, and what a package contributes besides TypeScript. For
anyone writing a config. [`nts build`](cli.md#nts-build) is the command that
reads it.

## The file

```ts
import { app, defineConfig, library, target } from "@nts/config";

export default defineConfig({
  products: {
    tool: app.cli({ entry: "./src/main.ts" }),
    core: library.native({
      entry: "./src/library.ts",
      targets: [target.linux(), target.macos({ minimumVersion: "13.0" }), target.windows()],
    }),
  },
});
```

- **One name, one place:** `nts.config.ts`, beside the project's
  `tsconfig.json`. A build does not search upward for one.
- **Evaluated, not parsed.** The file runs under node (`NTS_NODE` names the
  binary), and its default export, the value `defineConfig` returns, is what
  the build reads. It is evaluated once per process. A config that node cannot
  run, that throws, or that has no default export stops the build.
- **`@nts/config` is an ordinary dependency** of the project
  (`tooling/config/`). Its constructors return plain data, so a resolved config
  can be read, cached and compared.
- **Required exactly where there is a build step.** A package of TypeScript
  only needs no config; its consumer compiles it, and it gets its type
  environment from `types` in its own `tsconfig.json`. A package with native
  sources, or anything that is itself an artifact, has one.
- **`tsconfig.json` stays the source of truth** for what the program is:
  `files`, `include`, `lib`, `strict`. The config refers to it and repeats none
  of it.
- **Two shapes share the file:** an application or library declares
  `products`; a package declares `targets`, `native`, `manifests` and
  `dependencies`, and no products.

A build is composed from three axes, kept apart because collapsing any two
makes a config that cannot say something real:

| axis | values | says |
|---|---|---|
| **kind** | application, executable, shared and static library, node addon, jar, AAR, XCFramework | what the artifact is and how it is consumed |
| **target** | Linux, macOS, iOS, Windows, Android, desktop JVM, Node-API | where it runs: its type surface, its floor, its machine |
| **backend** | `c`, `llvm`, `jvm` | how code is generated. iOS is not a backend: it is LLVM or C plus a triple |

## Top-level fields

| field | type | default | effect |
|---|---|---|---|
| `tsconfig` | `string` | `./tsconfig.json` | the program's tsconfig, relative to the config |
| `products` | `Record<string, Product>` | none | the artifacts, by name; [below](#products) |
| `targets` | `TargetId[]` | none | **package only:** the targets the package claims to support. A product built for a target its packages do not claim stops at configuration, naming the package |
| `native` | `NativeSources[]` | none | **package only:** directories of native sources; [below](#native-sources) |
| `manifests` | `Manifest[]` | none | **package only:** platform manifest fragments; [below](#manifests) |
| `dependencies` | `Record<TargetId, Dependencies>` | none | what the project needs that nts does not build, as another tool resolved it; [below](#dependencies) |
| `react` | `{ compiler?: boolean; compilationMode?: "infer" \| "annotation" \| "syntax" \| "all" }` | absent | runs TSX through the React Compiler (`compiler`, default `true`) and lowers JSX before nts reads it. Absent, JSX is refused |
| `integrate` | `Integration[]` | none | build-system hooks for a consumer outside nts; [below](#integrations) |
| `gi` | `Record<string, string>` | newest installed | the GIR version a `gi:` import means: `{ gtk: "4.0" }` |
| `girExtras` | `Record<string, GirExtra>` | none | per GIR namespace (`"HarfBuzz-0.0"`): `headers`, `packages` and `defines` its GIR does not name, as [`nts bind-gir`](cli.md#nts-bind-gir) takes them |
| `build.cache` | `{ local?: boolean; directory?: string }` | on, `.nts/cache` | the object cache: compiled objects kept between builds, valid while every header each read still hashes the same. `local: false` turns it off |
| `workspace` | `{ root: string; packages?: string[]; tsconfigBase?: string }` | none | root config only: the workspace's packages and shared settings. Typed, and not read by the build |

## Products

A product is one artifact, built once per target it names. Its **`entry`**
(required, relative to the config) is its surface: a library or addon
publishes exactly what that module exports, and nothing else becomes a root.
A helper exported for a sibling module, or for tests, stays out of the
artifact unless the entry re-exports it.

### Kinds

| constructor | kind | targets | artifact | state |
|---|---|---|---|---|
| `app.cli({ entry, backend?, cpu? })` | `executable` | `target.linux()` | `<name>`, driven by libuv's event loop, or GLib's where the program links GLib | built |
| `app.linux({ entry, backend?, cpu? })` | `application` | `target.linux()` | the same | built |
| `app.windows({ entry })` | `application` | `target.windows()` | `<name>.exe`, driven by the Win32 message loop | built |
| `app.macos({ entry, id, minimumVersion, sdk? })` | `application` | `target.macos()` | `<name>` and `<name>.app` with an `Info.plist` | built |
| `app.ios({ entry, id, minimumVersion, sdk? })` | `application` | `target.ios()`, a device | `<name>.app` | a device build is refused, since it must be signed; the simulator builds through `app({ targets: [target.ios({ minimumVersion, arch: "x86_64" })] })` |
| `app.android({ entry, id, minSdk, compileSdk?, arch? })` | `application` | one `target.android()` per `arch` | `<name>.apk`, signed with a debug key | built |
| `app({ kind?, entry, targets, id? })` | `application` or `executable` | any | as above, per target | built |
| `library.native({ entry, targets, soname?, header?, prefix? })` | `shared-library` | Linux, macOS, Windows | `lib<name>.so`, `lib<name>.dylib`, or `<name>.dll` with its import library `<name>.lib` | built |
| `library.staticNative({ ... })` | `static-library` | the same | `lib<name>.a`, or `<name>.lib` on Windows | built |
| `library.node({ entry, apiVersion?, platforms? })` | `node-addon` | one `target.node()` per platform | `<name>.node` | built |
| `library.jvm({ entry, javaPackage, release? })` | `jar` | `target.jvm()` | `<name>.jar`, with `nts-runtime.jar` beside it | built |
| `library.android({ entry, javaPackage, minSdk, compileSdk?, consumerProguard? })` | `aar` | `target.android()` | `<name>.aar`: `classes.jar`, its manifest, `proguard.txt`, pinned jars in `libs/` | built |
| `library.xcframework({ entry, targets, moduleName })` | `xcframework` | Apple targets | refused by name: `xcodebuild -create-xcframework` is not driven. Build `shared-library` slices instead | refused |

An application on a desktop JVM target (`app({ targets: [target.jvm()] })`) is
a runnable jar whose entry evaluates the module and drains its event loop. A
kind on the wrong backend (an `aar` on Linux, a `shared-library` on the JVM)
is refused before anything is written, naming the backend it belongs to.

### Product options

| option | on | type | default | effect |
|---|---|---|---|---|
| `entry` | every product | `string` | required | the module whose exports are the surface |
| `id` | applications | `string` | none | the reverse-DNS identifier: `CFBundleIdentifier` on Apple, the package name in an APK's generated manifest. Required for macOS and iOS bundles and for an APK whose project supplies no manifest; never invented |
| `backend` | `app.cli`, `app.linux` | `"c" \| "llvm"` | `"c"` | passed to the target |
| `cpu` | `app.cli`, `app.linux` | `"baseline"` | x86-64-v3 | passed to the target |
| `soname` | native libraries | `string` | `lib<name>.so` etc. | the shared library's file name, its ELF `soname` and its Mach-O install name (`@rpath/<file>`) |
| `header`, `prefix` | native libraries | `string` | product name | the installed header and the prefix on exported C symbols. Typed, and not read by the build |
| `apiVersion` | `library.node` | `number` | `8` | the Node-API version, which is the target's id |
| `platforms` | `library.node` | `{ os, arch }[]` | Linux x86-64 | one target per machine |
| `javaPackage` | `jar`, `aar` | `string` | required | the package the generated classes are in, in place of `nts.gen` |
| `release` | `library.jvm` | `number` | `8` | the `javac --release` level |
| `consumerProguard` | `aar` | `string` | none | R8 rules shipped to the consumer, as `proguard.txt` |
| `minSdk`, `compileSdk`, `arch` | Android products | `number`, `number`, `Arch \| Arch[]` | `compileSdk` = `minSdk`; `aarch64` | as on `target.android()`; an application takes several `arch` |
| `moduleName` | `xcframework` | `string` | required | the Swift module a consumer imports |

### What every native library carries

- **An export list that publishes only the entry's exports,** in the
  platform's form: a version script on ELF, an exported-symbols list on
  Mach-O, a module-definition file on Windows. An exported class has no C
  symbol, since the boundary hands out no way to obtain one; the build names
  each such export.
- **Self-initialization:** a shared or static library evaluates its module
  when it is loaded, through a constructor appended to the program itself (so
  an archive cannot drop it); an executable's `main` does it instead.
- **Link guards:** unresolved symbols are a link error for a shared library
  (`--no-undefined` on ELF), and an addon is checked after linking for
  anything unresolved but `napi_*`. Where a program binds C, the binding's
  witness is compiled against the real headers before linking, so a layout nts
  believes and the header contradicts stops the build.

## Targets

A target is a platform type surface plus a machine. Its **`id`** names the
surface a program typechecks against and keys every cache; two targets with
one id are one target. Its **`minimumVersion`** is the oldest OS it runs on,
which is a different number from the SDK it compiles against.

| constructor | id | os | arch (default) | backend (default) | options |
|---|---|---|---|---|---|
| `target.linux(o?)` | `linux-gnu` | `linux` | `x86_64` | `c` | `arch`, `backend: "c" \| "llvm"`, `cpu: "baseline"` |
| `target.windows(o?)` | `windows` | `windows` | `x86_64` | `c` | `arch`, `backend` |
| `target.macos(o)` | `macos-<sdk>` | `macos` | `aarch64` | `c` | `minimumVersion` (required), `sdk` (default: its major), `arch`, `backend` |
| `target.ios(o)` | `ios-<sdk>` | `ios` | `aarch64` | `c` | as `macos` |
| `target.android(o)` | `android-<compileSdk>` | `android` | `aarch64` | `jvm` | `minSdk` (required), `compileSdk` (default `minSdk`), `arch` |
| `target.jvm(o?)` | `java-<release>` | `jvm` | none | `jvm` | `release` (default `8`) |
| `target.node(o?)` | `node-api-<apiVersion>` | `linux` by default | `x86_64` | `c` | `apiVersion` (default `8`), `os`, `arch` |
| `target.chromium(o?)` | `linux-gnu` | `linux` | `x86_64` | `c` | as `linux`; adds the DOM's declarations and its native half ([Chromium](../targets/chromium.md)) |

- **Architectures** are `x86_64`, `aarch64` and `armv7`. There is no
  `wasm32` and no Wasm target: the Wasm backend is being rebuilt on Binaryen
  and builds nothing today ([Wasm](../targets/wasm.md); S-1 in
  [open questions](../open-questions.md)).
- **Backends** a target names are `c`, `llvm` and `jvm`.
- **`cpu`:** an x86-64 target builds for x86-64-v3 (AVX2, BMI2, FMA) unless it
  says `cpu: "baseline"`; the program stops with a sentence on an older CPU
  ([numbers](../foundations/numbers.md#how-native-code-is-built)).
- **Output:** each target's artifacts go to `<out>/<product>/<id>[-<arch>]/`.

### Toolchains

| target | compiles with | notes |
|---|---|---|
| the host | `CC`, default `clang` | ThinLTO where it is clang; the CPU flags. An explicit `CC` wins for any target |
| Linux on another arch | `zig cc -target <arch>-linux-gnu` | |
| Windows | `clang` with zig's mingw-w64 headers, linked by `zig cc` | libuv from `NTS_WINDOWS_ROOT` |
| macOS from Linux | `clang -target … -isysroot … -fuse-ld=lld` | a real SDK (`NTS_APPLE_SDK`) or zig's Darwin libc arranged as one |
| iOS simulator | `clang` with `iPhoneSimulator.sdk` | `NTS_IOS_SIMULATOR_SDK` |
| JVM, Android | `javac` and `jar`; for an APK the SDK's `aapt2`, `d8` and `apksigner` | the SDK from `ANDROID_HOME`; a missing component names the `sdkmanager` line that installs it |

A cross toolchain builds without ThinLTO and without the CPU flags. A missing
toolchain is reported before anything is resolved or written.

### Claims are floors

A package's `targets: ["android-29"]` claims it needs API 29 at run time. A
versioned claim covers a target of the same family whose **floor**
(`minimumVersion`, else the id's version) is at least the claim's: `android-29`
covers an app compiling against `android-36` with `minSdk: 29`, and not one
with `minSdk: 21`. Unversioned ids (`linux-gnu`, `windows`) match exactly. The
same rule decides which `native` roots, `manifests` and `dependencies` apply
to a target.

## Native sources

```ts
native: [sources({ dir: "native", header: "digest.h", targets: ["linux-gnu"] })]
```

| field | type | effect |
|---|---|---|
| `dir` | `string` | a directory of native sources, relative to the config |
| `header` | `string` | the C header a `c:` module's binding is generated from |
| `targets` | `TargetId[]` | the targets it is compiled for; absent, every target |

- **Declarations before bodies:** a build generates the bindings, typechecks
  and emits the program against them, then compiles the native sources.
- **The program names what to bind:** `import { digest_step } from "c:digest"`
  says the module, the import list says the names, and the package above the
  importing file says the header. Type-only imports bind records.
- **What is compiled:** `.c` on every native target; `.m` and `.swift` on macOS
  and iOS only (elsewhere a refusal naming the target); `.java` on JVM targets,
  compiled into the artifact. A JVM root with no Java is refused.
- **Objective-C:** a project's header `native/Greeter.h` is the module
  `objc:Greeter`, bound with its Swift names; a directory of `.swift` is a
  module named for the directory, as a SwiftPM target is.

## Manifests

A manifest fragment is what a package adds to its consumer's platform
manifest: an Android permission, an iOS usage key.

| field | type | effect |
|---|---|---|
| `targets` | `TargetId[]` | the targets it is for |
| `path` | `string` | the fragment file |
| `requiresValue` | `string[]` | keys whose value the consumer must write. Typed, and not read by the build |

- **An AAR carries** its package's one fragment as `AndroidManifest.xml`, for
  the consumer's Gradle to merge; several for one target are refused.
- **An APK is the last artifact,** so nothing merges after it: an application
  with its own fragment uses it; one with none gets a manifest generated from
  its `id`; one with none while its packages contribute fragments is refused,
  because the generated manifest would silently lack them.

## Dependencies

`dependencies` maps a target id to the output of the resolver that pinned it.
nts reads that output and never runs a resolver, so what ships is what was
reviewed. A build consults only the entry covering the target it builds.

| `from` | reads | contributes |
|---|---|---|
| `pkg-config` | `packages` | runs `pkg-config`: `--cflags` to every compile, `--libs` to the link |
| `maven`, `gradle` | `lockfile`: a TSV of pinned jars with SHA-256 digests | each jar, digest-verified, on the classpath. A runnable jar unpacks them inside it; an AAR ships them in `libs/`; an APK dexes them in; a library jar ships none |
| `cocoapods` | `lockfile`: `Podfile.lock`, and `Pods/` beside it | each pod compiled and bound as an `objc:` module |
| `swiftpm` | `lockfile`: `Package.resolved`, the checkouts and manifests | each library target compiled and bound |
| `npm` | `lockfile` | validated and reported; contributes nothing, since an addon's consumer installs its own `node_modules` |
| `vcpkg` | | refused by name, for the targets that name it |

A pinned jar is found beside the lockfile, in `~/.m2/repository`, or in the
Gradle cache (`GRADLE_USER_HOME`), in that order. A file at the expected place
with the wrong digest fails the build; it is never a reason to look further.

## Integrations

`integrate` lists hooks that run `nts build` from a consumer's own build
system, written into the output root after the artifacts.

| value | writes |
|---|---|
| `cmake` | `nts.cmake`: one imported library per product and target (`nts::<name>`, or `nts::<name>_<target>` where a product has several), built by a custom command whose output is the artifact and whose input is the product's entry |
| `npm` | `nts-prepare.mjs`, for `package.json`'s `prepare` script, building for the installing machine's OS |
| `gradle`, `swiftpm`, `cocoapods`, `msbuild`, `maven` | refused by name before anything is built |

## Platform type surfaces

The declarations a platform's modules (`objc:AppKit`, `c:Gtk-4.0`, the Win32
and WinRT namespaces) are typed by are **generated on the machine, once per
SDK and set of inputs**, by the platform's binder, and kept in a shared store,
`~/.cache/nts/types/<identity>/<version>/<inputs>` (`NTS_TYPES_ROOT`).

- **Every command that compiles the project generates them** as its imports
  need them: Apple frameworks for macOS and iOS targets, Win32 and WinRT for
  Windows targets, GIR namespaces otherwise. Each package is linked into the
  project's `node_modules`. A project lists the platform package in its
  tsconfig's `types` only for tools that do not run nts, such as an editor.
- **A surface package marks itself** (`"nts": { "surface": "objc" }` in its
  `package.json`) and holds declarations only, each file opening with
  `// @ts-nocheck`, since its binder's tests check it. Generated code a binding
  needs (Swift's `async` forms, GIR's casts) is a values module kept beside it
  and compiled with the program.
- **A package's own `c:` bindings,** generated by `nts build` from the header
  its `native` entry names, are written into the project as
  `types/c-<module>.d.ts`.
- Whether some surfaces are also published is open (B-3 in
  [open questions](../open-questions.md)).

## Not in the config

- **Memory management.** Shipped native programs count references; the JVM
  uses its host's collector. Nothing in a config chooses otherwise.
- **Providers and Intl's locales.** Choosing a builtin's provider per product
  (`providers`), and the locales Intl carries, are designed in
  [builtins](../foundations/builtins.md#profiles), not built.

## Decisions

- **x86-64 builds default to x86-64-v3,** with a clear error on an older CPU and
  `cpu: "baseline"` as the portable opt-out
  ([log](../records/notebooks/decisions-log.md#numbers-and-json-10-22)).
- **Shipped native programs count references;** never-freeing is for tests
  ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
- **An app may override a builtin's provider in `nts.config.ts`,** but only
  with a provider that has a conformance record; designed, not built
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22), decision 6).
- **nts never depends on a system package.** The host toolchain, libuv and the
  node that evaluates configs still come from the system (T-1 and D-1 in
  [open questions](../open-questions.md))
  ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
