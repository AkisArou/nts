# Targets at a glance

Every environment an nts program runs in, and what each is built from. A build
is an artifact kind, a target and a backend ([`nts-config.md`](nts-config.md));
a row here is the environment the program ends up running inside, because that
decides its memory, strings and builtins. Facts as of `main` `a5dd00f69`,
2026-10-27.

**● built** · **◐ decided, not built** · **○ open** · **=** as the native
row.

| environment | backend | memory | strings | builtins and globals | JSON | Unicode, Intl | Map, Set | event loop | status |
|---|---|---|---|---|---|---|---|---|---|
| **Native** (Linux, macOS, Windows) | C, LLVM | ● counting, cycle collector, stack frames, call regions · ◐ one placement analysis, per-site regions, reuse, mimalloc trial ([memory](foundations/memory.md)) | ● 1 or 2 bytes per unit, inline, cached hash · ◐ data pointer, flags ([strings](foundations/strings.md)) | ● a fixed list lowered to `runtime/c` · ◐ providers per target | ● typed `stringify` · `parse` as ordinary TS · ◐ typed `parse`, simdjson | ● QuickJS case tables · ◐ own tables (D1), ICU4C for Intl (D3) | ● FNV-1a, unseeded · ◐ keyed, tree fallback ([hashing](foundations/hashing.md)) | ● libuv | ● gated on Linux x86-64 |
| **GTK** | = | = · ● cycles through GObjects collected | = · UTF-8 at the C boundary | = · GIR bindings | = | = | = | ● GLib's loop drives libuv | ● built, 17 interop tests |
| **Apple** (macOS, iOS) | = | = · retain/release, autorelease pools · ○ cycles through blocks leak | = · `NSString` at the boundary | = · `objc:` bindings | = | = | = · ObjC keys by `-hash` | ● CFRunLoop drives libuv | ● built; ran on x86_64 VMs only, no Mac now |
| **Windows UI** (Win32, WinRT, WinUI 3) | = | = · COM `AddRef`/`Release` · ○ handler cycles leak until unsubscribed | = · HSTRING lent | = · `.winmd` bindings | = | = | = | ● libuv on IOCP plus a message window | ● W0–W3 built; VM only |
| **Node addon** | = | = inside; no JS value held, so no cycle across heaps | copied both ways | = | = | = | = | ● node's own loop · promise exports refused | ● built |
| **Chromium** (electron-like) | = | = · Oilpan, V8 and nts heaps · ○ cycles across heaps not collected | `StringView` in, copied out | ● Blink's DOM through `nts:dom` · no `node:*` | = | = · ◐ host Intl | = | ● Blink's loop, no libuv | ● Linux, opt-in, Chromium 154, not gated |
| **JVM** (desktop) | JVM | ● the JVM's collector | ● `java.lang.String` · ◐ destination passing | ● `runtime/jvm` (Java 8) | ● typed `stringify` · ○ `parse` | ● JDK tables, wrong against node · ◐ own tables (D4) · ○ Intl: the TS over ICU4J exists, unreachable | ● `String.hashCode`, floodable · ○ J2 | ● own promise queue | ● 748/748 examples |
| **Android** | JVM, DEX | ● ART's collector | = JVM | = JVM · Android provider, API 26+ | = JVM | = JVM · ICU4J bundled | = JVM | = JVM | ● APK and AAR build; compiled cases ran on ART by hand, not gated |
| **Wasm in a JS host** (node, browsers) | Wasm | ● WasmGC | ● the host's strings, JS String Builtins | ● helpers plus host imports · ◐ host Intl, RegExp | ● typed `stringify` · ○ `parse` | ● the host's, zero bytes | ● FNV-1a 32-bit · ◐ keyed | ● own queue per export, host timers | ● 748/748 on node; browser by hand |
| **Wasm standalone, WASI** | Wasm | ◐ WasmGC, Wasmtime first | ◐ GC UTF-16 arrays | ◐ nts's own | ◐ as hosted | ◐ own tables in data segments · ◐ no Intl (D6) | ◐ keyed | ○ WASI 0.2 or 0.3 | ○ nothing built |

## Gaps every environment shares

- **Weak references** (`WeakRef`, `WeakMap`, `WeakSet`,
  `FinalizationRegistry`) are refused everywhere. They are decided to exist
  exactly (M3); native is memory stage 7, and the JVM and Wasm designs are J1
  and W1 ([JVM and Wasm](foundations/jvm-and-wasm.md)).
- **RegExp** has no engine on any backend yet. Decided: compile-time matchers
  plus the TypeScript interpreter in `runtime/ecmascript`, and the host's on JS
  hosts and in Chromium.
- **Holes in arrays of numbers** read as 0 on C, a recorded wrong answer, and
  are refused on Wasm. The proposed fix is X1.
- **Map hashing** is unseeded everywhere; [hashing](foundations/hashing.md) has
  the design.
- **Builtins are a fixed list in the compiler,** and anything else is refused.
  The mechanism that declares a provider per target has its 11 product
  decisions ([`decisions.md`](decisions.md)) and a proposed design
  ([builtins](foundations/builtins.md)); most of it is unbuilt.
- **`Intl` is reachable nowhere.** It is not a provided global, so every
  backend refuses it, although TypeScript implementations over ICU4C and ICU4J
  exist in `runtime/ecmascript`.
- **The clock and randomness are refused:** `Date.now()`, `new Date()` and
  `Math.random()`. Decision 2 says they come from the environment, seeded under
  the differential tests; lowering still refuses them. The providers are
  designed in [builtins](foundations/builtins.md#the-clock-and-randomness).

## What a program can call, per target

**C** a `runtime/c` helper (C and LLVM) · **J** `runtime/jvm` or the JDK ·
**W** generated inside the Wasm module · **H** a JS host import · **B** Blink
through `nts:dom` · **R** refused today · **∅** a permanent non-goal · **TS**
a TypeScript implementation exists but no program reaches it · **◐** decided,
not built · **=** as native. *Native* covers standalone, GTK, Apple and
Windows UI, which share one C runtime; *JVM* covers desktop and Android.

### ECMAScript

| | Native | Node addon | Chromium | JVM | Wasm, JS host | Wasm standalone |
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
| ArrayBuffer, typed arrays, DataView | C (4 kinds R) | C, copied | = | J | W | ◐ |
| SharedArrayBuffer, Atomics | R (with workers) | R | R | R | R | ◐ |
| errors | C (8 classes; `stack` R) | = | = | J | W | ◐ |
| Proxy, Reflect, `globalThis`, `Object.freeze` and its family | R · ◐ in scope, deferred | R · ◐ | R · ◐ | R · ◐ | R · ◐ | R · ◐ |
| `eval`, `Function` | ∅ | ∅ | ∅ | ∅ | ∅ | ∅ |

### Web platform

| | Native | Node addon | Chromium | JVM | Wasm, JS host | Wasm standalone |
|---|---|---|---|---|---|---|
| console (strings only) | C | C | C (stdout, not DevTools) | J | W | ◐ |
| timers | C on the platform's loop | node's loop | B | J | W, host timers | ○ |
| URL, fetch, streams, Blob, AbortController, EventTarget | R · TS | R | B (URL, fetch, Blob, events) | R · TS | R · ◐ host | ◐ |
| TextEncoder, TextDecoder | R · TS | R | R | R | R · ◐ host | ◐ |
| crypto, performance, structuredClone, atob, queueMicrotask | R | R | B (`randomUUID`, `performance`, `queueMicrotask`) | R | R | ◐ |
| WebSocket | R · TS | R | R | R · TS | R | ◐ |
| DOM | none | none | B (3,155 of lib.dom's 3,625 members) | none | R · ◐ (Wasm milestone M3) | none |

### Node

| | Native | Node addon | Chromium | JVM | Wasm |
|---|---|---|---|---|---|
| `process`, `Buffer`, `node:*` | R · 28 modules in TS and C, no resolver yet · ◐ native only | per-module conformance addons only | never | R | R |

### Platform SDKs

| target | SDK | reached through |
|---|---|---|
| Native | libc, any C library | `c:` imports; C calls TypeScript through `program.h` |
| GTK | GTK 4, GLib, Gio | `gi:` imports generated from GIR |
| Apple | AppKit, Foundation, UIKit | `objc:` imports, a typed `objc_msgSend` per call |
| Windows UI | Win32, WinRT, WinUI 3 | `c:`, and `winrt:` from `.winmd` |
| Node addon | Node-API | the addon's exports |
| Chromium | Blink | `nts:dom`, generated from Blink's IDL |
| JVM, Android | the Java library, the Android SDK (API 26+) | `java:` imports, `nts bind` |
| Wasm, JS host | the JS host | generated ES-module glue |
| Wasm standalone | WASI | open |

## Notes per environment

- **Native.** Untyped values are 16-byte tag-plus-payload values. BigInt is
  exact to 128 bits and stops the program by name beyond. Number formatting is
  zmij; parsing is ffc. `c:` imports reach C, and `program.h` lets C call
  TypeScript ([native interop](native-interop.md)).
- **GTK.** The one environment where cycles through host objects are collected:
  a GObject holding signal closures joins the trace, counted by its own
  `ref_count` (`tests/interop/gtk-cycles`). [Lane](gtk-lane-goal.md).
- **Apple.** Typed `objc_msgSend` per call site, no libffi. AppKit's delegates
  and targets do not retain, which avoids the commonest cycles.
  [Lane](apple-lane-goal.md).
- **Windows UI.** Calls through vtable slots fixed at compile time. WinUI 3
  subclasses use COM aggregation; the toolchain is mingw via zig.
  [Lane](windows-lane-goal.md).
- **Node addon.** A published class instance is wrapped with `napi_wrap`, its JS
  wrapper owning one count. Closures, promises and other JS values are refused
  at the boundary, which is why no cycle can form.
- **Chromium.** Three heaps, none collecting another: listeners must be removed
  explicitly until the joint Oilpan and holder collection is built.
  [Architecture](../runtime/chromium/docs/architecture.md).
- **JVM and Android.** Proved integers are `int` or `long`. Arrays are bare JVM
  arrays unless the program grows one. Java code is reached through `nts bind`
  and `java:` imports ([JVM interop](jvm-interop.md),
  [Android](jvm-android-provider.md)).
- **Wasm.** WasmGC with no linear memory, needing GC, typed function
  references, exceptions, tail calls and SIMD. Emission moves to Binaryen IR
  (decided 10-25). [Wasm](wasm.md).

Where the JVM and Wasm go from here, and the decisions still to make:
[JVM and Wasm](foundations/jvm-and-wasm.md).
