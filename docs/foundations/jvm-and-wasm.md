# The foundations on the JVM and Wasm

**Status:** proposed 2026-10-27, for the user's approval. Both lanes are paused
until phase 4 ([plan](../plan.md)); this page settles their foundations first,
as the native pages did, so native decisions meant for every backend are
checked against these two while still cheap to change. Facts are as of `main`
`a5dd00f69`. Questions that need outside evidence are in a research request
(listed at the end).

The backends' own documents hold the detail: [`../wasm.md`](../wasm.md),
[`../jvm-interop.md`](../jvm-interop.md),
[`../jvm-android-provider.md`](../jvm-android-provider.md).

## Where they stand

**Built** works today; *decided* is settled but not built; open has no
decision yet.

| | JVM (desktop, Android) | Wasm, JS-hosted (node, browsers) | Wasm, standalone and WASI |
|---|---|---|---|
| **memory** | **built:** the JVM's collector (ART on Android); counting is refused | **built:** WasmGC structs and arrays, no linear memory | *decided:* WasmGC objects, linear memory only at the WIT boundary; engine Wasmtime first |
| **weak references** | open: refused today on every backend, as `WeakRef`, `WeakMap`, `WeakSet` and `FinalizationRegistry` are; the user decided they will exist | open | open |
| **strings** | **built:** `java.lang.String` (one or two bytes per unit, like native) and `StringBuilder`; *decided:* destination passing, no `invokedynamic` | **built:** the host's strings as `externref` through the JS String Builtins (`wasm:js-string`), with no copy | *decided:* GC-owned UTF-16 arrays |
| **numbers** | **built:** `int`, `long`, `double`; BigInt to 128 bits; Grisu2 formatting; *decided:* a zmij port | **built:** i32, i64, f64; erased values as `anyref` with i31 small integers; BigInt to 128 bits | open: formatting without the host |
| **Unicode** | **built:** the JDK's tables (Unicode 15 on JDK 21: wrong against node); *decided (D4):* nts's tables | **built and decided:** the host's, through imports: zero bytes | *decided:* the compiler's tables as data segments |
| **Intl** | open: a TypeScript Intl over ICU4J 78.3 exists in `runtime/ecmascript`, but `Intl` is not a provided global, so no program reaches it | *decided:* the host's; refused today | *decided (D6):* not provided |
| **RegExp** | none on any backend; *decided:* compile-time matchers plus the TypeScript interpreter in `runtime/ecmascript` | *decided:* the host's | *decided:* nts's own (as the JVM) |
| **JSON** | **built:** typed `stringify`; no `parse`; *decided:* a generated parser with Java kernels | **built:** typed `stringify`; no `parse` | as hosted, without the host |
| **Map and Set** | **built:** `NtsTable`, insertion-ordered; string hash `String.hashCode` × constant, floodable | **built:** a WasmGC table; 32-bit FNV-1a, unseeded, recomputed every lookup; *decided:* the shared keyed definition | *decided:* the shared keyed definition |
| **async** | **built:** nts's own promise queue (`NtsPromise`, `NtsEnv`) | **built:** nts's own queue, drained at each export; timers through the host | open: the WASI version (0.2 or 0.3, which adds async) |
| **host interop** | **built:** `nts bind` from class files, `java:` imports, TypeScript called from Java; a Java exception reaching a `catch`: open | **built:** generated ES-module glue; JS objects, functions, symbols and BigInts at the boundary: open | open: WIT, including lone surrogates |
| **emission** | **built:** class files for Java 8, no `invokedynamic` | **built:** a direct encoder; *decided (10-25):* lower to Binaryen IR and let Binaryen optimize and write the module | as hosted |
| **status** | `jvm` 748/748; test262 language 4255/4333; 2398/2398 classes verify; Android APK and AAR build, `dex` 852/852 | `wasm` 748/748 on node; test262 language 4255/4333; the browser checked by hand | nothing built |

## Proposed decisions

Each is a recommendation; the user approves or changes it.

| # | decision | why |
|---|---|---|
| J1 | **Weak references on the JVM:** `WeakRef` is a `java.lang.ref.WeakReference`, with targets read during a job held until the job ends, as the specification's KeepDuringJob requires. `FinalizationRegistry` runs from a `ReferenceQueue` that `NtsEnv` drains between jobs, never on a collector thread. `WeakMap` and `WeakSet` are ephemerons by the **transposed representation**: the entry lives on the key, in a hidden slot of nts objects, and the map holds nothing strongly. | Java has no ephemerons. A `WeakHashMap` leaks whenever a value refers to its key, which M3 rejects. Holding the entry on the key is exact under any tracing collector. Keys that are foreign Java objects need research first. |
| J2 | **Map hashing on the JVM:** keep the cached `String.hashCode` for strings and add the per-table tree fallback of [hashing](hashing.md); numbers and BigInts use the shared keyed definition (today's `hi*31+lo` for BigInt goes). An amendment of hashing's "one definition" for this one case, measured on the map rows before it is final. | A keyed hash cannot be cached in `java.lang.String`, so every lookup would rehash its probe string, while the cached hash costs nothing. The tree fallback bounds flooding to O(log n) whatever the hash, as Java's own `HashMap` does with tree bins. |
| J3 | **`Math` on the JVM:** match node bit for bit, per decisions.md: research whether `StrictMath` (fdlibm) equals V8's `ieee754` ports function by function, and port V8's where it does not. | `StrictMath` and V8 both descend from fdlibm, but "both descend" is not "bit-identical". |
| J4 | **A Java exception reaching TypeScript** is a catchable `Error` (`JavaError`) carrying the throwable as `cause`. | Declining makes every throwing Java API unusable from TypeScript. |
| W1 | **Weak references on Wasm:** JS-hosted uses the host's `WeakRef`, `FinalizationRegistry` and `WeakMap` through imports, since WasmGC objects are JavaScript objects. Standalone does not provide `WeakRef` or `FinalizationRegistry` (as D6 does for Intl), and gives `WeakMap` and `WeakSet` the transposed representation of J1. | Hosted engines already implement ephemerons and finalization exactly. WasmGC has no weak references, so a standalone engine gives nothing to hook. Research confirms both premises first. |
| W2 | **Character reads of hosted strings:** the host's strings stay the representation. A loop the compiler proves scans many characters copies them once into a GC `i16` array (`intoCharCodeArray`) and reads that. | The `strings` row is 34x C today. Whether per-character import calls are the cause is research's first question, so this is measured before it is built. |
| W3 | **`stringref` is rejected**, resolving the conflict between `wasm.md`'s two mentions of it. *Decided by the user, 2026-10-27.* | The proposal stalled, while the JS String Builtins (hosted) and GC UTF-16 arrays (standalone) cover both profiles. |
| W4 | **Erased values use i31 for small integers,** locked as the code does it. *Decided by the user, 2026-10-27.* | No allocation for small integers, the common case. |
| W5 | **JS values the program imports** (objects, functions, symbols) are `externref` handles whose use is typed by the program's `.d.ts`, the shape the JVM's `java:` imports have. BigInt converts at the boundary. Exports already have a rule: record 0356 decides how exported objects cross the glue. | One interop model for both managed backends, extending 0356 to imports. Research first: how Kotlin/Wasm, dart2wasm, J2Wasm and Hoot do it. |
| W6 | **The standalone engine is Wasmtime first,** with reclamation tests (cycles included) before any program is promised to run. WIT strings replace lone surrogates with U+FFFD, as `TextEncoder` does. | A standalone program's memory is only as good as the engine's collector. Research first: whether Wasmtime's collector reclaims cycles. |
| W7 | **The Binaryen pin** is the first release whose C API constructs `try_table` and `throw_ref`, with WasmGC and imported strings. | The 10-25 decision stands; only the version is open. |
| W8 | **JSON on Wasm:** typed `JSON.parse(text) as T` is the parser the compiler generates per type, as on native, reading the text once copied into a GC `i16` array (SIMD where the engine has it). Untyped `parse` on a JS host is research's choice between the host's `JSON.parse` plus conversion, and the same generated parser. | Native's simdjson cannot link into WasmGC, since it needs linear memory, so no external library fits. Research first: whether the host's parse, plus converting its objects, beats parsing inside Wasm. |
| X1 | **Holes in arrays of numbers, every backend:** a reserved NaN bit pattern marks a hole, as V8's holey double arrays do. Stores into an array that may have holes canonicalize NaN, and reads check only where the compiler cannot prove the slot was written. | Native C reads a hole as 0, a recorded wrong answer (`tests/outcomes/a-hole-in-an-array-of-numbers-reads-as-zero`), and Wasm refuses those reads instead. One representation fixes both. Research first: V8's technique and its cost. |

## Found on the way (fixes, not decisions)

- The runnable jar's launcher calls only `module$init()`, so timers would never
  fire there (`tooling/cli/src/main.rs`, untested): it should run `NtsMain`,
  with a timer test.
- Stale documentation: the JVM is said to compile under `NoGc`
  (`nts-config.md`, `jvm-interop.md`). Android builds are said to be refused.
  `NtsGrisu.java` cites the removed `nts_grisu.h`. `wasm.md` follow-up F7
  and part of its BigInt note are done.

## Research

The questions behind J1–J3, W1, W2, W5–W7 and X1 are in
`~/.cache/nts-handover/chatgpt/research-jvm-wasm-20261027.md`; their answers
are folded in here before the decisions are final.
