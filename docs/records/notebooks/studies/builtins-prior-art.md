# Prior art: declaring and resolving builtin dependencies per target

Researched 2026-10-22 from primary sources (official docs, specs, source repos).
Each entry covers: (a) how the surface is declared, (b) how an implementation is
picked per target, (c) what happens when a target lacks it, (d) the effect on
binary size and dead-code removal, (e) what nts should take from it or avoid.
"Unconfirmed" marks a claim no primary source fetched here states.

## 1. Kotlin Multiplatform `expect` / `actual`

- (a) An `expect` declaration (fun, property, class, interface, enum, annotation) lives in `commonMain` and has no body.
- (b) An `actual` with the same fully qualified name lives in a platform source set, or in an intermediate one such as `iosMain`, which is shared by `iosArm64Main` and `iosSimulatorArm64Main`. "The Kotlin compiler merges the expected and actual declarations." `actual typealias Month = java.time.Month` lets a host type satisfy the declaration directly.
- (c) The compiler requires that "every expected declaration in the common source set has a matching actual declaration in every platform-specific source set", so a missing actual is a build failure. The one exemption is `@OptionalExpectation` on annotations.
- Source-set hierarchy: "each source set has access only to the API that is available for all targets to which that source set compiles". Platform libraries (iOS, for example) are visible only in source sets whose targets all have them.
- (d) There is no runtime dispatch: each target links only its own actual.
- (e) Take the **completeness check per target at build time**, and the **host type as a valid actual** (a typealias). Avoid its documented quirk that `native` can see full iOS APIs when only iOS targets exist, which their own page calls counter-intuitive.
- Sources: https://kotlinlang.org/docs/multiplatform/multiplatform-expect-actual.html · https://kotlinlang.org/docs/multiplatform/multiplatform-hierarchy.html

## 2. Rust `cfg`, `target_feature`, `std` / `core` / `alloc`

- (a) Items are gated with `#[cfg(target_os = "linux")]`, `target_family`, `target_feature = "avx2"` and `target_has_atomic = "64"`. These values are fixed by the target and "it is not possible to set a configuration option from within the source code". `cfg_attr(target_os="linux", path="linux.rs")` picks an implementation file. `cfg_select!` is a compile error when no arm matches.
- (b) The target triple fixes the cfg set. `#![no_std]` swaps the `std` prelude for `core`, and `alloc` must be brought in explicitly. The crate layering itself declares the capability: `core` needs nothing, `alloc` needs a heap, `std` needs an OS.
- (c) Two different answers:
  - Under `no_std`, a `std` item is a compile error (it does not resolve).
  - On `wasm32-unknown-unknown`, `std` is present but "many parts of the standard library do not work and return errors": `println!` does nothing, `std::fs` always returns errors, `thread::spawn` panics, and "there is no means by which this can be overridden".
- (d) Removing a cfg'd item takes it out of the build entirely. Its removal phase relative to type checking is not stated on the reference page.
- (e) Take the **layered capability crates** (core/alloc/std ≈ language / heap / host) and **cfg keys fixed by the target**. **Avoid the wasm32-unknown-unknown stub `std`**: code that compiles and then silently fails is exactly the failure mode nts must refuse.
- Sources: https://doc.rust-lang.org/reference/conditional-compilation.html · https://doc.rust-lang.org/reference/names/preludes.html · https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html

## 3. .NET platform attributes, CA1416, TFMs, feature switches

- (a) An API is annotated `[SupportedOSPlatform("windows10.0.19041")]` or `[UnsupportedOSPlatform("browser")]`, with optional versions, on an assembly, type or member. An unattributed API "is considered to work on all OS platforms". Platform inclusion applies: iOS implies MacCatalyst.
- (b) The project's platform comes from the TFM. `net8.0-windows10.0.19041` makes MSBuild inject `[assembly: SupportedOSPlatform(...)]`, and multi-target projects list `<SupportedPlatform>` items. A call site is "in context" if:
  - its project targets that platform,
  - it is guarded by `OperatingSystem.IsWindows()`, `IsWindowsVersionAtLeast` or a custom `[SupportedOSPlatformGuard]`, or
  - it is itself attributed, which passes the requirement up to its callers.
- (c) Analyzer CA1416 warns with a message naming the platforms: "This call site is reachable on all platforms. 'X' is only supported on: 'windows' 10.0.19041 and later". At run time an unsupported API typically throws `PlatformNotSupportedException` (unconfirmed here as a general rule).
- (d) Feature switches (`InvariantGlobalization`, `UseSystemResourceKeys`, `EventSourceSupport`, `Http3Support`) "cause the related code to be trimmed". `InvariantGlobalization=true` "removes globalization-specific code and data" (the ICU dependency). `UseNativeHttpHandler=true` "uses the default platform implementation of HttpMessageHandler for Android and iOS and removes the managed implementation". The same public API is served by a host provider or an own provider, chosen per target with a switch.
- (e) Take three things:
  - **Capability attributes on declarations plus a reachability analyzer** whose diagnostic names the supported platforms.
  - **Guards the analyzer understands**, to allow narrowing.
  - **Named switches that pick host versus own provider and let the trimmer drop the other.**
  
  Avoid making it a warning: for AOT it should be an error.
- Sources: https://learn.microsoft.com/en-us/dotnet/standard/analyzers/platform-compat-analyzer · https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trimming-options · https://learn.microsoft.com/en-us/dotnet/core/runtime-config/globalization

## 4. Engine-internal bindings: Node `internalBinding`, Deno ops, Bun

- **Node.** C++ bindings are registered with `NODE_BINDING_CONTEXT_AWARE_INTERNAL()` and reached through `internalBinding(name)`, which is private. `process.binding` is a legacy allowlist (`fs`, `buffer`, `zlib`, `tcp_wrap`, ...), and any other name throws `No such module` at run time. Builtin JS modules (`lib/*.js`) are compiled into the binary (`BuiltinModule`), and option-gated builtins become requirable only with a flag.
  - Builds choose what exists: `--with-intl=none|system-icu|small-icu|full-icu`. Under `none`, "`Intl` (object does not exist)", `Date.prototype.toLocaleString()` "behaves identically to `toString()`", and Unicode property escapes are an "invalid RegExp error". The documented trade-off is size: small-icu "provides a balance between features and binary size".
- **Deno.** `deno_core::extension!(name, deps=[..], ops=[op_a,..], esm=["x.js"], lazy_loaded_esm=[..], state=..)` declares one unit that holds native ops (Rust `#[op2]` functions with typed argument attributes such as `#[string]`, `#[buffer]`, `#[smi]`, with V8 fast calls) and the JS that wraps them. Extensions declare their `deps`. Type surfaces are selected by `lib`: `deno.window` (default), `deno.worker`, `deno.ns`, `deno.unstable` and `dom`.
- **Bun.** Builtins are TypeScript under `src/js` (`node/`, `bun/`, `thirdparty/`, `internal/`). They are preprocessed (`$` maps to JSC private intrinsics, and `require("…")` becomes a numeric id), and in release builds they are "minified and inlined into the binary". `process.platform` and `process.arch` are inlined and dead-code eliminated. Native code is reached through `*.bind.ts` schemas from which "the bindings generator ... generates the glue". Bun's own docs list **four overlapping ways** to reach native code (bindgen, the classes generator, JS2Native `$cpp`/`$rust`, host functions), which is a cautionary example.
- (e) Take three things:
  - **One extension unit = typed native ops + the source-language code over them + declared deps** (Deno).
  - **Builtins in the source language, compiled into the artifact, with platform constants folded** (Bun).
  - **A typed schema for the native boundary from which the glue is generated** (Bun bindgen, Deno op2).
  
  Avoid Node's run-time `No such module` and its silent `none`-mode degradation, and avoid Bun's several overlapping native-binding mechanisms.
- Sources: https://github.com/nodejs/node/blob/main/lib/internal/bootstrap/realm.js · https://nodejs.org/api/intl.html · https://docs.rs/deno_core/latest/deno_core/macro.extension.html · https://raw.githubusercontent.com/denoland/deno/main/libs/ops/op2/README.md · https://docs.deno.com/runtime/reference/ts_config_migration/ · https://github.com/oven-sh/bun/blob/main/src/js/README.md · https://bun.com/docs/project/bindgen.md

## 5. AOT and embedded JS engines

- **Static Hermes.** It offers optional AOT native compilation of soundly typed JS (TS/Flow annotations). Its typed mode has native types (`c_ptr` ...) and zero-cost C FFI inside `"use unsafe"` (from the author's slides). Untyped code still runs through the Hermes VM.
  - Hermes Intl is a **host provider**: it "is essentially projecting the Android platform provided internationalization facilities" (ICU4J) and uses iOS platform facilities, which causes "some variance in behaviours across Android and iOS". Several NumberFormat and DateTimeFormat options are unsupported on iOS, and Intl is an optional build (about 57–62 KB per ABI).
  - Unconfirmed: whether shermes-native binaries link the full Hermes VM runtime for all builtins.
- **Porffor.** It is an AOT JS compiler ("compiles JS to C (with an IR inbetween)"). Builtins are TypeScript in `compiler/builtins/`. `precompile.js` compiles them to IR and Huffman-codes them into `builtins_precompiled.js`. A builtin is included only when codegen meets a live call (`h.includeBuiltin(name)`), and type-switch arms whose types are not used are never walked: "a compile only decodes the builtins it actually touches". **This is tree-shaking of builtins by construction.**
- **AssemblyScript.** The std lib is AssemblyScript (`std/assembly`). Compiler intrinsics are `@builtin export declare function clz<T>(v: T): T`, with no body. Host imports are an ambient `declare function`, renamed with `@external("module","name")`: "Ambient declarations ... will yield a WebAssembly module import". Reachability: the compiler "starts at the module's exports and only compiles what's reachable". The runtime variant is a build-time choice (`--runtime incremental|minimal|stub|<path>`).
- **GraalJS.** Builtins are Java (Truffle) classes (`com.oracle.truffle.js.builtins`: GlobalBuiltins, ConsoleBuiltins, PolyglotBuiltins, `math/`, `json/`). The surface is chosen by options:
  - `js.ecmascript-version` (default latest, recommended pinned), `js.intl-402` (default true), `js.console` (true) and experimental `js.temporal`.
  - Non-standard builtins: `js.print`, `js.load`, `js.polyglot-builtin`, `js.graal-builtin`, `js.crypto` (off).
  - In Node mode, "Node.js provides its own implementation that is used instead" (of console).
- **Javy.** It compiles JS to Wasm running QuickJS. It supports ES2023 plus partial TextEncoder/TextDecoder, `console.log/error`, and a `Javy.IO` namespace, and "NodeJS APIs are not supported". The API set is a **plugin** (a Rust crate with `javy-plugin-api`) whose `config()` enables features (`text_encoding(true)`, `javy_stream_io(true)`) and whose `modify_runtime` adds globals. Dynamic linking imports the plugin's namespace (1–16 KB modules), while static linking embeds it (≥ 869 KB). Unconfirmed: the exact CLI flags for selecting a plugin (`-C plugin=`) and the `-J` feature list. Only `-J simd-json-builtins` is confirmed.
- (e) Take three things:
  - Porffor's **builtins in the source language, precompiled, included on use**.
  - AssemblyScript's **bodiless `declare` as the import or intrinsic contract**, with the runtime chosen at build time.
  - Hermes' and GraalJS's **host providers with documented variance**.
  
  Avoid GraalJS-style option soup without per-target defaults written down.
- Sources: https://raw.githubusercontent.com/facebook/hermes/static_h/doc/IntlAPIs.md · https://speakerdeck.com/tmikov2023/static-hermes-react-native-eu-2023-announcement · https://github.com/CanadaHonk/porffor · https://raw.githubusercontent.com/CanadaHonk/porffor/main/compiler/precompile.js · https://www.assemblyscript.org/concepts.html · https://www.assemblyscript.org/runtime.html · https://raw.githubusercontent.com/AssemblyScript/assemblyscript/main/std/assembly/builtins.ts · https://raw.githubusercontent.com/oracle/graaljs/master/docs/user/JavaScriptCompatibility.md · https://raw.githubusercontent.com/oracle/graaljs/master/docs/user/Options.md · https://github.com/bytecodealliance/javy · https://raw.githubusercontent.com/bytecodealliance/javy/main/docs/docs-using-js-api-support.md · https://raw.githubusercontent.com/bytecodealliance/javy/main/crates/plugin-api/README.md

## 6. TypeScript's `lib`, `types`, `noLib`, `customConditions`

- (a) `lib` selects built-in declaration files. These are high-level (`ES2022`, `ESNext`, `DOM`, `WebWorker`, `ScriptHost`) or fine-grained (`ES2015.Promise`, `ESNext.Intl`, `DOM.Iterable`), and the default follows `target`. `noLib` "disables the automatic inclusion of any library files", and you must then supply `Array`, `Boolean`, `Function`, `IArguments`, `Number`, `Object`, `RegExp` and `String` yourself.
- `/// <reference lib="es2017.string" />` pulls one lib from a file and is recommended for declaration authors. `/// <reference types="node" />` is "an `import` for declaration packages".
- `libReplacement` resolves `@typescript/lib-*` packages first.
- `types` "By default ... is set to `[]`. For versions below TypeScript 6.0, by default all visible `@types` packages are included." A package not listed "will not add globals".
- `customConditions` adds conditions to `exports`/`imports` resolution (only for node16, nodenext and bundler).
- (b) TS only type-checks. It has no notion of an implementation, so `lib: ["dom"]` happily type-checks `fetch` on a target that has none.
- (c) A missing lib is a type error (TS2304 or TS2552). A lib present with no implementation fails at run time.
- (e) Take two things. **Selecting the type surface per target** is already TS's mechanism, so nts should keep using `lib`/`types` for the *surface*. **`customConditions`** lets tsgo resolve a per-target implementation file through `imports` conditions, so the type checker and nts's resolver could agree on which provider is in the program.
- Sources: https://www.typescriptlang.org/tsconfig/#lib · https://www.typescriptlang.org/tsconfig/#types · https://www.typescriptlang.org/tsconfig/customConditions.html · https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html

## 7. WinterTC (Ecma TC55): Minimum Common Web API, runtime keys

- **Minimum Common API, §5.1 interfaces on `globalThis`:**
  - Events: AbortController, AbortSignal, Event, EventTarget, CustomEvent, ErrorEvent, PromiseRejectionEvent, MessageChannel, MessageEvent, MessagePort.
  - DOMException.
  - Fetch and files: Headers, Request, Response, FormData, Blob, File.
  - Compression and streams: CompressionStream, DecompressionStream, all of Streams (readable, writable, transform, queuing strategies, BYOB).
  - Encoding: TextEncoder, TextDecoder, TextEncoderStream, TextDecoderStream.
  - URL: URL, URLSearchParams, URLPattern.
  - Crypto: Crypto, CryptoKey, SubtleCrypto.
  - Performance.
  - The WebAssembly namespace classes.
- **§5.2 globals:**
  - Timers and utilities: setTimeout, setInterval, clearTimeout, clearInterval, queueMicrotask, structuredClone, atob, btoa, reportError.
  - `self`, `navigator.userAgent`.
  - Handlers: onerror, onunhandledrejection, onrejectionhandled.
  - fetch, console, crypto, performance.
  - WebAssembly.compile/instantiate(+Streaming)/validate, JSTag.
- **Workers are not required.**
- **Conformance is all-or-documented-deviation.** A runtime "shall provide the interfaces and properties listed" and may diverge "for technical or structural reasons" only with "clear documentation". No partial levels are defined. Extensions are allowed but "extending API surface ... should be avoided".
- **Runtime keys** is a TC55 report: a registry of runtime identifiers (`node`, `deno`, `bun`, `workerd`, `edge-light`, `netlify`, `fastly`, `react-native`, `moddable`, `electron`, `quickjs`, ...) "to prevent conflicts", whose informative annex uses them as package.json `exports` conditions. It does not specify combination with `import`/`require`/`default`.
- (e) Take two things:
  - **A named, versioned profile as the unit of conformance** ("wintertc-min" = this list), with **documented deviations** rather than silent gaps.
  - **Registering nts's own condition keys** (for example `nts`, plus per-target keys) instead of inventing a private scheme.
- Sources: https://min-common-api.proposal.wintertc.org/ · https://runtime-keys.proposal.wintertc.org/

## 8. Briefly

- **package.json conditional `exports` / `imports`.** Key order is priority ("most specific to least specific"), and `"default"` goes last. Built-in conditions: `node-addons`, `node`, `import`, `require`, `module-sync`, `default`. Others come from `--conditions`. The `imports` field (`"#dep": {"node": "dep-node-native", "default": "./dep-polyfill.js"}`) is a package-private, per-environment choice of implementation, and the closest existing idiom to "provider by target". https://nodejs.org/api/packages.html#conditional-exports
- **Go build constraints.** `//go:build linux && amd64`, and file names `*_GOOS`, `*_GOARCH`, `*_GOOS_GOARCH` carry "an implicit build constraint requiring those terms". A function no file provides for the target is the ordinary compile error `undefined: f` (standard Go behavior, not quoted from the page). https://pkg.go.dev/cmd/go#hdr-Build_constraints
- **Zig.** std code switches on `@import("builtin").os.tag` / `builtin.target` at comptime and ends unsupported arms with `@compileError`. Because analysis is lazy, the error fires only if the arm is referenced, so unsupported APIs cost nothing until used. Unconfirmed from the language reference fetched here: only a forum example and the docs' lazy namespace-analysis sentence were seen. https://ziglang.org/documentation/master/

## Synthesis: recurring patterns

1. **Declare once, implement per target, check completeness at build time.** Kotlin expect/actual, Go build tags (`undefined`), Rust cfg and `cfg_select!`, and Zig `@compileError` all fail the build, naming the declaration, when a target has no implementation. The anti-pattern is the stub that compiles and fails at run time: Rust `wasm32-unknown-unknown` std, Node `--with-intl=none` (`toLocaleString` == `toString`), Node's `No such module`.
2. **Capability annotations on declarations plus a reachability analyzer whose diagnostic names the supported platforms** (.NET `SupportedOSPlatform` + CA1416). The KMP source-set rule is the same check: a source set sees only the intersection of its targets' APIs. Guards narrow the context.
3. **Implementation selection by ordered target keys with a default** (package.json `exports`/`imports` conditions, WinterTC runtime keys, TS `customConditions`, Rust `cfg_attr(path=…)`, Go file suffixes). The order is the rule set, and it is data.
4. **Builtins written in the source language, compiled with the program, included only when reached** (Porffor precompiled builtins with `includeBuiltin` on use, AssemblyScript std from exports, Bun `src/js` inlined with platform constants folded, Node `lib/*.js`). Binary size then follows use, not the surface.
5. **A thin, typed native-primitive layer declared by a schema with generated glue** (Deno `#[op2]` ops in an `extension!` with `deps`, Bun `*.bind.ts`, Node `internalBinding`, AssemblyScript `@external`/`declare` imports, Javy plugins). One mechanism matters: Bun's four overlapping ones are the warning.
6. **Host provider versus own provider for the same public API, chosen per target by a named switch, with the other trimmed** (.NET `UseNativeHttpHandler`, `InvariantGlobalization`; Hermes Intl from Android ICU4J or iOS; GraalJS Node mode replacing `console`; Node `system-icu` versus `full-icu`). Every one of them documents behavioral variance as the price.
7. **A named, versioned conformance profile** (WinterTC Minimum Common API, Deno `deno.window` vs `deno.worker`, TS `lib` names, GraalJS `ecmascript-version`): the unit a target claims and a test suite checks, with documented deviations.

**Best fit for nts** (several backends, several hosts, TypeScript in and out):

- **Surface** = TS `lib`/`types`/`.d.ts`, unchanged (pattern 7 + §6). nts should not invent a second type-surface mechanism.
- **Provider manifest** = condition-keyed data per builtin family (pattern 3), resolved by nts at build time, ordered most specific first with a `default`. Example: `@nts/provider fetch: { "chromium": host, "wasm-js": host, "jvm-android": "./fetch.okhttp.ts", "default": "./fetch.ts" }`. It is mirrored into package `imports` conditions plus tsgo `customConditions` so the editor sees the same choice.
- **Completeness = refusal, never a stub** (pattern 1), checked over what is reachable (pattern 2). The message names the target and the providers that exist ("`fetch` is not available on target `linux-glib`: providers are host (chromium, wasm-js), nts (default; needs `nts:net`)"). This is Kotlin's check with .NET's wording.
- **Own providers in TypeScript** (`runtime/ecmascript`, `runtime/web-platform`), compiled with the program and included on reach (pattern 4).
- **One typed native-primitive layer underneath** (pattern 5: nts already has `declare` + `@nts*` attributes and a C helper catalog, so make that the only one).
- **Host-versus-own choice as a named, per-target default that `nts.config.ts` can override**, with variance documented per provider (pattern 6). Conformance is claimed per (profile × target × provider) and checked by its suite (test262, WPT, node's tests), which is the WinterTC lesson.

## What could not be confirmed from a primary source

- Rust: the phase at which a false `cfg` removes an item relative to type checking.
- .NET: `PlatformNotSupportedException` as the general run-time behavior of unsupported APIs.
- Static Hermes: whether native output links the whole Hermes VM runtime for builtins; the FFI details (`c_int`, `$SHBuiltin.extern_c`, `"use unsafe"`) come from the author's slides, not docs.
- Bun: `$zig` / `$newZigFunction` (the current docs name `$cpp` and `$rust` under JS2Native, plus `$bindgen`).
- Javy: the `-C plugin=` and `-J` feature flags beyond `simd-json-builtins`.
- Deno: how plain ops are called from JS (`Deno.core.ops` vs `ext:core/ops`). Only the `objects` import from `ext:core/ops` is documented on the fetched page.
- Kotlin: whether a `linux` intermediate source set exists (the template is a diagram).
- Zig: lazy analysis of `@compileError` arms, from the language reference itself.
- Go: the exact `undefined:` wording.
- TypeScript 6.0's `types: []` default: confirmed by the TSConfig reference; the devblogs announcement itself was not fetched.
