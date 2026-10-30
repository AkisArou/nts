# Targets

Every environment a compiled program runs in, and what each is built from. A
build is an artifact kind, a target and a backend
([`nts.config.ts`](../reference/nts-config.md)); a row here is the environment
the program ends up running inside, because that decides its memory, strings
and builtins. Each environment has a page of its own, listed at the end.

**●** built · **◐** decided, not built · **○** open · **=** as the native row.

| environment | backend | memory | strings | builtins and globals | JSON | Unicode, Intl | Map, Set | event loop | status |
|---|---|---|---|---|---|---|---|---|---|
| **[Native](native.md)** (Linux, macOS, Windows) | C, LLVM | ● counting, cycle collector, stack frames, call regions · ◐ one placement analysis, per-site regions, reuse, mimalloc trial ([memory](../foundations/memory.md)) | ● 1 or 2 bytes per unit, inline, cached hash · ◐ data pointer, flags ([strings](../foundations/strings.md)) | ● a fixed list lowered to `runtime/c` · ◐ providers per target ([builtins](../foundations/builtins.md)) | ● typed `stringify` · `parse` R · ◐ typed `parse`, simdjson ([JSON](../foundations/json.md)) | ● QuickJS case tables · ◐ own tables (D1), ICU4C for Intl (D3) ([Unicode](../foundations/unicode.md)) | ● FNV-1a, unseeded · ◐ keyed, tree fallback ([hashing](../foundations/hashing.md)) | ● libuv | ● gated on Linux x86-64 |
| **[GTK](gtk.md)** | = | = · ● cycles through GObjects collected | = · UTF-8 at the C boundary | = · GIR bindings | = | = | = | ● GLib's loop drives libuv | ● built; interop tests in the full run |
| **[Apple](apple.md)** (macOS, iOS) | = | = · retain/release, autorelease pools · ○ cycles through blocks leak | = · `NSString` at the boundary | = · `objc:` bindings | = | = | = · ObjC keys by `-hash` | ● CFRunLoop drives libuv | ● built; has run on x86_64 VMs only, no Mac now |
| **[Windows UI](windows.md)** (Win32, WinRT, WinUI 3) | = | = · COM `AddRef`/`Release` · ○ handler cycles leak until unsubscribed | = · HSTRING lent | = · `.winmd` bindings | = | = | = | ● libuv on IOCP plus a message window | ● Win32, WinRT and WinUI 3 built; run on a VM only |
| **[Node addon](node-addon.md)** | C | = inside; no JS value held, so no cycle across heaps | copied both ways | = | = | = | = | ● node's own loop · promise exports refused | ● built, Linux only |
| **[Chromium](chromium.md)** (electron-like) | C, LLVM | = · Oilpan, V8 and nts heaps · ○ cycles across heaps not collected | `StringView` in, copied out | ● Blink's DOM through `nts:dom` · no `node:*` | = | = · ◐ host Intl | = | ● Blink's loop, no libuv | ● Linux, opt-in, Chromium 154, not gated |
| **[JVM](jvm.md)** (desktop) | JVM | ● the JVM's collector | ● `java.lang.String` · ◐ destination passing | ● `runtime/jvm` (Java 8) | ● typed `stringify` · ○ `parse` | ● JDK tables, wrong against node · ◐ own tables (D4) · ○ Intl: the TS over ICU4J exists, unreachable | ● `String.hashCode`, floodable · ○ J2 | ● own promise queue | ● gated |
| **[Android](jvm.md#android)** | JVM, DEX | ● ART's collector | = JVM | = JVM · Android provider, API 29+ | = JVM | = JVM · ICU4J bundled | = JVM | = JVM | ● APK and AAR build; compiled cases run on ART by hand, not gated |
| **[Wasm in a JS host](wasm.md)** (node, browsers) | Wasm (Binaryen) | ◐ WasmGC | ◐ the host's strings, JS String Builtins | ◐ helpers plus host imports · ◐ host Intl, RegExp | ◐ typed `stringify` · ○ `parse` | ◐ the host's, zero bytes | ◐ FNV-1a 32-bit · ◐ keyed | ◐ own queue per export, host timers | ○ being rebuilt on Binaryen; nothing built ([Wasm](wasm.md)) |
| **[Wasm standalone, WASI](wasm.md#standalone-and-wasi)** | Wasm | ◐ WasmGC, Wasmtime first | ◐ GC UTF-16 arrays | ◐ nts's own | ◐ as hosted | ◐ own tables in data segments · ◐ no Intl (D6) | ◐ keyed | ○ WASI 0.2 or 0.3 | ○ nothing built |

## Gaps every environment shares

- **Weak references** (`WeakRef`, `WeakMap`, `WeakSet`,
  `FinalizationRegistry`) are refused everywhere. They are decided to exist
  exactly (M3); native is memory stage 7, and the JVM and Wasm designs are J1
  and W1 ([JVM and Wasm](../foundations/jvm-and-wasm.md)).
- **RegExp** has no engine on any backend. Decided: compile-time matchers plus
  the TypeScript interpreter in `runtime/ecmascript`, and the host's on JS
  hosts and in Chromium.
- **Holes in arrays of numbers** read as 0 on C, a recorded wrong answer.
  The rule is decided: such a read gives `undefined`
  ([types](../language/types.md#when-a-types-claim-is-false-at-run-time));
  the proposed representation is X1.
- **Map hashing** is unseeded everywhere; [hashing](../foundations/hashing.md)
  has the design.
- **Builtins are a fixed list in the compiler,** and anything else is refused.
  The mechanism that declares a provider per target has its product decisions
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22))
  and an approved design ([builtins](../foundations/builtins.md)); most of it
  is unbuilt.
- **`Intl` is reachable nowhere.** It is not a provided global, so every
  backend refuses it, although TypeScript implementations over ICU4C and ICU4J
  exist in `runtime/ecmascript`.
- **The clock and randomness are refused:** `Date.now()`, `new Date()` and
  `Math.random()`. Decision 2 says they come from the environment, seeded under
  the differential tests; lowering refuses them. The providers are designed in
  [builtins](../foundations/builtins.md#the-clock-and-randomness).

## What a program can call, per target

**C** a `runtime/c` helper (C and LLVM) · **J** `runtime/jvm` or the JDK ·
**W** generated inside the Wasm module · **H** a JS host import · **B** Blink
through `nts:dom` · **R** refused · **TS** a
TypeScript implementation exists but no program reaches it · **◐** decided,
not built · **=** as native. *Native* covers standalone, GTK, Apple and
Windows UI, which share one C runtime; *JVM* covers desktop and Android.

### ECMAScript

| | Native | Node addon | Chromium | JVM | Wasm, JS host (Binaryen design) | Wasm standalone |
|---|---|---|---|---|---|---|
| Object, Function, Array, Symbol, Map, Set | C | = | = | J | W | ◐ |
| String | C · `normalize`, `localeCompare`, locale case R | = | = | J | H and W | ◐ |
| Number, BigInt | C (zmij, ffc; BigInt to 128 bits) | = | = | J | H and W | ◐ |
| Math | C · `random` R · ◐ V8-identical | = | = | J (`StrictMath`) | H and W | ◐ |
| Date | C: `new Date(ms)` and `getTime` only · TS for the rest | = | = | J, same | W, same | ◐ |
| JSON | `stringify` C · `parse` R · ◐ typed `parse` | = | = | `stringify` J · `parse` R | `stringify` W · `parse` R | ◐ |
| RegExp | R · ◐ compiled literals plus a TS interpreter | R | R · ◐ host | R · ◐ ours | R · ◐ host | ◐ ours |
| WeakMap, WeakSet, WeakRef, FinalizationRegistry | R · ◐ (M3) | R | R | R · J1 proposed | R · W1 proposed | R · W1 proposed |
| Promise | C on the loop | C on node's loop | C on Blink's microtasks | J | W, own queue | ◐ |
| Intl | R · TS over ICU4C | R | R · ◐ host | R · TS over ICU4J | R · ◐ host | not provided (D6) |
| Temporal | R · TS | R | R | R · TS | R | ◐ |
| ArrayBuffer, typed arrays, DataView | C (not every kind) | C, copied | = | J | W | ◐ |
| SharedArrayBuffer, Atomics | R (with workers) | R | R | R | R | ◐ |
| errors | C (`stack` R) | = | = | J | W | ◐ |
| Proxy, Reflect, `globalThis`, `Object.freeze` and its family | R · ◐ in scope, deferred | R · ◐ | R · ◐ | R · ◐ | R · ◐ | R · ◐ |
| `eval`, `Function` | R · a permanent boundary (L1) | R | R | R | R | R |

### Web platform

| | Native | Node addon | Chromium | JVM | Wasm, JS host (Binaryen design) | Wasm standalone |
|---|---|---|---|---|---|---|
| console (strings only) | C | C | C (stdout, not DevTools) | J | W | ◐ |
| timers | C on the platform's loop | node's loop | B | J | W, host timers | ○ |
| URL, fetch, streams, Blob, AbortController, EventTarget | R · TS | R | B (URL, fetch, Blob, events) | R · TS | R · ◐ host | ◐ |
| TextEncoder, TextDecoder | R · TS | R | R | R | R · ◐ host | ◐ |
| crypto, performance, structuredClone, atob, queueMicrotask | R | R | B (`randomUUID`, `performance`, `queueMicrotask`) | R | R | ◐ |
| WebSocket | R · TS | R | R | R · TS | R | ◐ |
| DOM | none | none | B (most of lib.dom; the rest is listed in `tooling/chromium/bindgen/report.json`) | none | R · ◐ (Wasm milestone M3) | none |

### Node

| | Native | Node addon | Chromium | JVM | Wasm |
|---|---|---|---|---|---|
| `process`, `Buffer`, `node:*` | R · `runtime/node`'s modules in TS and C, no `node:` resolver · ◐ native only | per-module conformance addons only | never | R | R |

### Platform SDKs

| target | SDK | reached through |
|---|---|---|
| [Native](native.md) | libc, any C library | `c:` imports; C calls TypeScript through `program.h` |
| [GTK](gtk.md) | GTK 4, GLib, Gio | `gi:` and `c:` imports generated from GIR |
| [Apple](apple.md) | AppKit, Foundation, UIKit | `objc:` imports, a typed `objc_msgSend` per call |
| [Windows UI](windows.md) | Win32, WinRT, WinUI 3 | `c:Windows.Win32.*` from Win32 metadata, `winrt:` from `.winmd` |
| [Node addon](node-addon.md) | Node-API | the addon's exports |
| [Chromium](chromium.md) | Blink | `nts:dom`, generated from Blink's IDL |
| [JVM, Android](jvm.md) | the Java library, the Android SDK | `java:` imports, `nts bind` |
| [Wasm, JS host](wasm.md) | the JS host | generated ES-module glue |
| [Wasm standalone](wasm.md#standalone-and-wasi) | WASI | ◐ WIT |

## The pages

- [Native](native.md): command-line programs and libraries on Linux, macOS and
  Windows; calling C, and C calling TypeScript.
- [Calling C](calling-c.md): how a program calls a C library, the types at the
  boundary and the contract each call keeps.
- [C headers](c-headers.md): binding a C library from its headers, and how C's
  number types become TypeScript types.
- [GTK](gtk.md), [Apple](apple.md), [Windows](windows.md): each platform's SDK
  from TypeScript, its event loop, and memory and strings at its boundary.
- [Node addon](node-addon.md): a TypeScript module as a Node-API addon.
- [Chromium](chromium.md): native code driving Blink in Chromium's renderer.
- [JVM and Android](jvm.md): class files, jars, APKs and AARs, and Java in
  both directions.
- [Wasm](wasm.md): WasmGC modules for JS hosts, and the standalone profile.
- Where the JVM and Wasm go next, and what is still to decide for them:
  [JVM and Wasm](../foundations/jvm-and-wasm.md).

## Decisions

- On JS hosts (Wasm in a browser or node, Chromium) the host's builtins are
  taken, starting with Intl and RegExp; native and standalone Wasm use nts's
  own (decision 3,
  [log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
- `node:*` APIs are native only, and never in a Chromium renderer (decision 8,
  [log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
- Native (C and LLVM) comes first; the JVM and Wasm are designed after it
  ([log](../records/notebooks/decisions-log.md#priorities-and-order)).
- test262 runs on every built backend, the JVM included; Wasm rejoins when
  its Binaryen backend exists
  ([log](../records/notebooks/decisions-log.md#wasm-10-24-10-25)).
- Apple and Windows programs may stay unrun at a landing whose only refusals
  are their platform skips
  ([log](../records/notebooks/decisions-log.md#team-and-process)).
- No hardware is bought yet, so Apple, Windows and arm64 builds stay unrun at
  landing. When the macOS host work begins, an Apple-silicon Mac mini is
  bought first; a Windows machine and an arm64 device come later (A-1; 10-28,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
