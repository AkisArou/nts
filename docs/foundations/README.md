# Foundations

The parts every nts program is built from: how a number, a string, an object or
a table is represented, what each operation on it costs, and how memory is
managed. Everything else (JSON, RegExp, Intl, node's APIs, apps) is built on
these, so they are decided first and decided once.

This directory is the design. [`../primitives.md`](../primitives.md) is the
measured table each foundation is held to, and [`../records/`](../records) keeps
the evidence behind each decision.

## The bar

- **Faster than node and Bun by a wide margin on every benchmark row**, and as
  close as possible to each target's own language: C++ for C and LLVM, Java for
  the JVM, C++ compiled to Wasm for Wasm.
- **Correct first:** node's behaviour is the oracle, down to the last bit of a
  formatted double.
- **Every speed fact is proved by the compiler,** never declared by the
  programmer or assumed by the runtime.
- **The checker first, proofs where TypeScript is unsound.** What TypeScript's
  checker knows is the first source of facts: the type at each reference after
  narrowing, the signature each call resolves to, literal and enum values,
  generic instantiations, modifiers. TypeScript is unsound by design in known
  places: covariant arrays, bivariant methods, `any`, `as` and `!`, index reads
  past the end, `private`, user-written type predicates, and what a `.d.ts`
  claims about foreign code. There, nts proves the fact itself, checks it at
  run time, or refuses
  ([types](../language/types.md#when-a-types-claim-is-false-at-run-time),
  [log](../records/notebooks/decisions-log.md#the-bar)). What a failed check
  does is register [L6](../open-questions.md#1-language-and-compiler). A layout
  taken from a declared class or field type is kept sound by those checks and
  refusals. Any other fact that licenses an unchecked operation (a narrowed
  type, a literal type, a container's contents) needs a proof: operator
  semantics, a guard dominating the same value, initialization analysis, or an
  invariant over every writer.
- **One answer per question across backends:** a fact several backends need is
  computed once in `compiler/core`, and each backend reads it.
- **Each platform gets its best implementation.** Shared code is reused where it
  is as fast; where it is not, each platform gets its own.
- **Native (C and LLVM) is designed first.** The JVM and the two Wasm profiles
  (JS-hosted and standalone) are kept in mind and designed after.

## The map

"Designed" means a design was agreed; "built"
means it is on main.

| Foundation | Covers | Native today | Open |
|---|---|---|---|
| **Numbers** ([design](numbers.md)) | integers proved from doubles, BigInt, `Math`, number ↔ text | Built: integer specialization, BigInt exact to 128 bits, zmij for number → text, ffc for text → number, x86-64-v3 builds, ThinLTO, aligned hot loops. | `Math` bit-identical to node (V8's fdlibm): decided, not built. BigInt past 128 bits: stops by name today, real bignums later. `Math.random` as V8's generator: designed. |
| **Strings** ([design](strings.md)) | layout, building, slicing, comparing, hashing, UTF-8 | One or two bytes per character, inline, with a cached hash. Built: in-place append, strings written where they are appended, SIMD JSON quoting, literal hashes. | Stage D (one data pointer, proved flags, slices that own their owner) and stage E (fewer passes and temporaries): designed. simdutf for UTF-8: prototyped, not built. |
| **Unicode and text data** ([design](unicode.md)) | case mapping, character classes, normalization, encodings | QuickJS's `libunicode` tables for case conversion; Final_Sigma is wrong on C and LLVM; most other features are refused. | Decided: the compiler owns the Unicode data, pinned to node's version, and emits only the tables a program uses. Not built. |
| **Hash tables** ([design](hashing.md)) | `Map`, `Set`, objects used as dictionaries | Insertion-ordered tables of 16-byte tagged keys and values; the static key type picks the hash and comparison, and the index keeps each entry's hash so growth never rehashes. | **Contradicts a decision:** main's hash is unseeded FNV-1a with literal hashes fixed at compile time; BigInt keys collide structurally; the JVM table can be flooded. Designed: one keyed definition (rapidhash with random secrets against SipHash-1-3, by the rows), lazy literal hashes, and a per-table tree fallback when probes run long. |
| **Objects and classes** ([design](objects.md)) | layouts, field access, interfaces, method calls | Fixed layouts per class, interfaces satisfied by shape, and a call through a value with at most two known classes becomes a direct call. | `instanceof` as a class-id range test, nullable fields: designed, not built. |
| **Arrays** ([design](objects.md#arrays)) | layout, growth, element sizes, bounds checks, typed arrays | Element widths and bounds facts; a compare no longer costs a field its array length. | A sort that moves elements without counting them: designed, not built. |
| **Functions as values** ([design](objects.md#functions-as-values)) | closures, indirect calls | A closure is an object with one method; known-class calls are direct. | Sets of classes for fields and return values, splitting call sites, typed adapters: designed, not built. |
| **Dynamic values** ([design](objects.md#dynamic-values)) | `any`, `unknown`, unions: a value carrying its type at run time | A 16-byte tagged value ([types](../language/types.md)). | Revisit with untyped JSON, which needs a new representation for it. |
| **Memory management** ([design](memory.md)) | reference counting, cycles, stack frames, regions, reuse | One ownership answer per value, borrowed calls, objects placed in the frame, counts elided, an inline retain/release fast path, a cycle collector that skips acyclic types, call regions. | Decided: one analysis gives every allocation site one home (frame, region or counted heap); then reuse for arrays and objects and a page allocator. Not built. |
| **Control flow** | exceptions, generators, async/await, the event loop | Mostly built ([async](../language/async.md)); the event loop is chosen per platform. | Gaps such as `next()` on an async generator. |
| **RegExp** | the regular-expression engine | Not provided. | Decided: matchers generated at compile time for literal patterns, plus the TypeScript interpreter in `runtime/ecmascript` for dynamic ones. Needs the Unicode data. |
| **JSON** | parse and stringify | `JSON.stringify` writes each layout through a writer the compiler generates. `JSON.parse` is not provided (NTS1100). | Designed: a parser generated per static type for `JSON.parse(text) as T`, simdjson's scanner on native, a new representation for untyped values. |
| **Builtins** ([design](builtins.md)) | which implementation of each global and module a target uses | One name list for every target; NTS1100 stops a build that reaches a missing builtin. | Proposed: features, providers and per-target profiles, resolved at build time; the clock and randomness with deterministic providers for the tests. |
| **Host boundary** | bytes, buffers, files, the network, C interop | C interop and the event loop are built. | Decided, not done: build libuv, zlib, brotli, zstd and OpenSSL from node's own sources instead of system libraries. |

Dates, time zones and Intl are built on these foundations
([design](time-and-intl.md)). On JS hosts (Wasm in a browser or node,
Chromium) they come from the host.

## Libraries we take from others

Vendored sources are pinned, unedited, baked into the `nts` binary and linked
only where used. nts never depends on a system package.

| Library | For | State |
|---|---|---|
| zmij | number → text (shortest round-trip) | built |
| ffc (fast_float in C) | text → number | built |
| simdutf | UTF-8 ↔ string conversion | prototyped: 3-8x faster on the UTF-8 rows |
| simdjson (its scanner only) | JSON parsing | decided |
| V8's fdlibm | `Math` matching node bit for bit | decided |
| libuv, zlib, brotli, zstd, OpenSSL | I/O, compression, crypto | decided |
| QuickJS `libunicode` | case conversion | to be replaced by the compiler's own Unicode data ([design](unicode.md)) |
| ICU4C 78.3 (node's version) | locale services only: collation, word breaking, Intl formatting | proposed ([design](unicode.md), decision D3) |

## The JVM and Wasm

The JVM uses its own collector, so reference counting does not apply there,
and Java's `String` already has nts's shape (one or two bytes per character).
Wasm in a JS host may use the engine's strings, `Math`, JSON, RegExp and Intl;
standalone Wasm carries everything itself. Their foundations are proposed in
[the JVM and Wasm](jvm-and-wasm.md), and the backends are described in
[targets/jvm.md](../targets/jvm.md) and [targets/wasm.md](../targets/wasm.md).

## The pages

Each foundation has its own page: what it is, its representation per backend,
what each operation costs, the decisions and why, the benchmark rows it is held
to, and what is still open.

| page | status |
|---|---|
| [Numbers](numbers.md) | built, except `Math` through V8's `ieee754` (decided) |
| [Strings](strings.md) | approved; stages 0, A and B built |
| [Unicode and text data](unicode.md) | decided, not built |
| [Hashing and hash tables](hashing.md) | designed, not built |
| [Objects, arrays and functions](objects.md) | built: layouts, interfaces by shape, dispatch, arrays, closures, dynamic values |
| [Memory management](memory.md) | decided; the new analysis not built |
| [JSON](json.md) | `stringify` built; typed `parse` designed |
| [Builtins](builtins.md) | proposed, for approval; stages 1 and 2 partly built |
| [Dates, time zones and Intl](time-and-intl.md) | providers and decisions; nothing bound as a builtin yet |
| [The JVM and Wasm](jvm-and-wasm.md) | proposed, for approval |

The order in which they are built is the [plan](../plan.md#phase-2-foundations-native-first).

## Decisions

On vendored code and libraries
([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)):

- Vendored sources are baked into the `nts` binary: no network at build time.
- nts never depends on a system package; a toolchain package that is missing
  is installed with `paru`.
- C++ is allowed in a vendored corner of the runtime, with no C++ standard
  library linked, except for Intl (D3, [Unicode](unicode.md)).
- The text codec costs at most about 200 KB, aiming for +51 KB with LTO.
- ICU ships locale subsets by default, with full data opt-in.
- OpenSSL 3.5 is vendored, replacing the system's libcrypto.
- The TypeScript URL and HTTP parsers stay, with ada and llhttp as C++
  references in benchmark rows, and are replaced only where a row loses.
