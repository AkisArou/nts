# The foundations on the JVM and Wasm

**Status:** proposed, for the user's approval; W3, W4 and J2 are decided. Both
backends are paused until phase 4 of the [plan](../plan.md). Their foundations
are settled first, so that native decisions meant for every backend are checked
against them while still cheap to change.

The backends' own pages hold the detail: [Wasm](../targets/wasm.md), and
[the JVM](../targets/jvm.md) with [Android](../targets/jvm.md#android).

## Where they stand

**Built** works today; *decided* is settled but not built; open has no
decision yet. In the Wasm columns, **built** entries are evidence from the
first, direct implementation for the Binaryen backend now being built, not
something on main ([Wasm](../targets/wasm.md)).

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
| **Map and Set** | **built:** `NtsTable`, insertion-ordered; string hash `String.hashCode` × constant, floodable; *decided:* the per-table tree fallback (J2) | **built:** a WasmGC table; 32-bit FNV-1a, unseeded, recomputed every lookup; *decided:* the shared keyed definition | *decided:* the shared keyed definition |
| **async** | **built:** nts's own promise queue (`NtsPromise`, `NtsEnv`) | **built:** nts's own queue, drained at each export; timers through the host | open: the WASI version (0.2 or 0.3, which adds async) |
| **host interop** | **built:** `nts bind` from class files, `java:` imports, TypeScript called from Java; a Java exception reaching a `catch`: *decided* as a catchable `Error` carrying it (I-2), its shape proposed as J4. Class openness: open. Emitted classes admit Java subclasses, and nts's closed-world direct calls bypass a Java override; one policy for openness and devirtualisation is needed (default-closed classes, with explicit Java-extension declarations, is the candidate) | **built:** generated ES-module glue; JS objects, functions, symbols and BigInts at the boundary: open | open: WIT, including lone surrogates |
| **emission** | **built:** class files for Java 8, no `invokedynamic` | *decided:* lower to Binaryen IR and let Binaryen optimize and write the module | as hosted |
| **status** | `jvm` 748/748; test262 language 4255/4333; 2398/2398 classes verify; Android APK and AAR build, `dex` 852/852 | being rebuilt on Binaryen IR: nothing built yet, the first implementation archived ([Wasm](../targets/wasm.md)) | nothing built |

## Proposed decisions

Each is a recommendation; the user approves or changes it.

| # | decision | why |
|---|---|---|
| J1 | **Weak references on the JVM:** `WeakRef` is a `java.lang.ref.WeakReference`, with targets read during a job held until the job ends, as the specification's KeepDuringJob requires. `FinalizationRegistry` runs from a `ReferenceQueue` that `NtsEnv` drains between jobs, never on a collector thread. `WeakMap` and `WeakSet` are ephemerons by the **transposed representation**: the entry lives on the key, in a hidden slot of nts objects, and the map holds nothing strongly. | Java has no ephemerons. A `WeakHashMap` leaks whenever a value refers to its key, which M3 rejects. Holding the entry on the key is exact under any tracing collector. Keys that are foreign Java objects need research first. |
| J2 | **Map hashing on the JVM:** keep the cached `String.hashCode` for strings and add the per-table tree fallback of [hashing](hashing.md); numbers and BigInts use the shared keyed definition (today's `hi*31+lo` for BigInt goes). An amendment of hashing's "one definition" for this one case, measured on the map rows before it is final. *Decided by the user,* with [hashing](hashing.md#decisions)'s keyed definition (X-4). | A keyed hash cannot be cached in `java.lang.String`, so every lookup would rehash its probe string, while the cached hash costs nothing. The tree fallback bounds flooding to O(log n) whatever the hash, as Java's own `HashMap` does with tree bins. |
| J3 | **`Math` on the JVM:** match node bit for bit, as [numbers](numbers.md#decisions) decides: research whether `StrictMath` (fdlibm) equals V8's `ieee754` ports function by function, and port V8's where it does not. | `StrictMath` and V8 both descend from fdlibm, but "both descend" is not "bit-identical". |
| J4 | **A Java exception reaching TypeScript** is a catchable `Error` (`JavaError`) carrying the throwable as `cause`. | Declining makes every throwing Java API unusable from TypeScript. |
| W1 | **Weak references on Wasm:** JS-hosted uses the host's `WeakRef`, `FinalizationRegistry` and `WeakMap` through imports, since WasmGC objects are JavaScript objects. Standalone does not provide `WeakRef` or `FinalizationRegistry` (as D6 does for Intl), and gives `WeakMap` and `WeakSet` the transposed representation of J1. | Hosted engines already implement ephemerons and finalization exactly. WasmGC has no weak references, so a standalone engine gives nothing to hook. Research confirms both premises first. |
| W2 | **Character reads of hosted strings:** the host's strings stay the representation. A loop the compiler proves scans many characters copies them once into a GC `i16` array (`intoCharCodeArray`) and reads that. | The `strings` row is 34x C today. Whether per-character import calls are the cause is research's first question, so this is measured before it is built. |
| W3 | **`stringref` is rejected**, resolving the conflict between `wasm.md`'s two mentions of it. *Decided by the user.* | The proposal stalled, while the JS String Builtins (hosted) and GC UTF-16 arrays (standalone) cover both profiles. |
| W4 | **Erased values use i31 for small integers,** locked as the code does it. *Decided by the user.* | No allocation for small integers, the common case. |
| W5 | **JS values the program imports** (objects, functions, symbols) are `externref` handles whose use is typed by the program's `.d.ts`, the shape the JVM's `java:` imports have. BigInt converts at the boundary. Exports already have a rule: record 0356 decides how exported objects cross the glue. | One interop model for both managed backends, extending 0356 to imports. Research first: how Kotlin/Wasm, dart2wasm, J2Wasm and Hoot do it. |
| W6 | **The standalone engine is Wasmtime first,** with reclamation tests (cycles included) before any program is promised to run. WIT strings replace lone surrogates with U+FFFD, as `TextEncoder` does. | A standalone program's memory is only as good as the engine's collector. Research first: whether Wasmtime's collector reclaims cycles. |
| W7 | **The Binaryen pin** is the first release whose C API constructs `try_table` and `throw_ref`, with WasmGC and imported strings. | The Binaryen decision stands; only the version is open. |
| W8 | **JSON on Wasm:** typed `JSON.parse(text) as T` is the parser the compiler generates per type, as on native, reading the text once copied into a GC `i16` array (SIMD where the engine has it). Untyped `parse` on a JS host is research's choice between the host's `JSON.parse` plus conversion, and the same generated parser. | Native's simdjson cannot link into WasmGC, since it needs linear memory, so no external library fits. Research first: whether the host's parse, plus converting its objects, beats parsing inside Wasm. |
| X1 | **Holes in arrays of numbers, every backend:** a reserved NaN bit pattern marks a hole, as V8's holey double arrays do. Stores into an array that may have holes canonicalize NaN, and reads check only where the compiler cannot prove the slot was written. | Native C reads a hole as 0, a recorded wrong answer (`tests/outcomes/a-hole-in-an-array-of-numbers-reads-as-zero`), One representation fixes both. Research first: V8's technique and its cost. |

## Research

J1, J3, W1, W2, W5–W8 and X1 wait on outside evidence, and are folded in here
before they are decided.

## Decisions

- **The Wasm backend** is one WasmGC backend, browser-first, with JS-hosted and
  standalone profiles. The compiler hands its code to Binaryen, which
  optimizes it, and linear memory is only for buffers and kernels
  ([log](../records/notebooks/decisions-log.md#wasm-10-24-10-25)).
- **test262 runs on every built backend,** the JVM included; Wasm rejoins
  when its Binaryen backend exists.
- **W3:** `stringref` is rejected. **W4:** erased values keep i31 for small
  integers ([log](../records/notebooks/decisions-log.md#team-and-process)).
- **J2:** on the JVM, strings keep the cached `String.hashCode` and gain the
  per-table tree fallback, while numbers and BigInts take the shared keyed
  definition; final once the map rows are measured (with X-4; 10-28,
  [log](../records/notebooks/decisions-log.md#debugging-security-and-versioning-10-28)).
