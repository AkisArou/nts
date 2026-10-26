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
- **One answer per question across backends:** a fact several backends need is
  computed once in `compiler/core`, and each backend reads it.
- **Each platform gets its best implementation.** Shared code is reused where it
  is as fast; where it is not, each platform gets its own.
- **Native (C and LLVM) is designed first.** The JVM and the two Wasm profiles
  (JS-hosted and standalone) are kept in mind and designed after.

## The map

State on main as of 2026-10-26. "Designed" means a design was agreed; "built"
means it is on main.

| Foundation | Covers | Native today | Open |
|---|---|---|---|
| **Numbers** | integers proved from doubles, BigInt, `Math`, number ↔ text | Built: integer specialization, zmij for number → text, ffc for text → number, x86-64-v3 builds, ThinLTO, aligned hot loops. | `Math` bit-identical to node (V8's fdlibm): decided, not built. BigInt past 64 bits: wraps today, real bignums later. |
| **Strings** | layout, building, slicing, comparing, hashing, UTF-8 | One or two bytes per character, inline, with a cached hash. Built: in-place append, strings written where they are appended, SIMD JSON quoting, literal hashes. | simdutf for UTF-8: prototyped, not built. Header flags (ASCII, escape-free) and one data pointer for every string kind: designed, not built. |
| **Unicode and text data** | case mapping, character classes, normalization, encodings | QuickJS's `libunicode` tables for case conversion. | The compiler carries the Unicode data and emits only the tables a program uses. *Study in progress.* |
| **Hash tables** | `Map`, `Set`, objects used as dictionaries | Insertion-ordered tables of 16-byte tagged keys and values; the static key type picks the hash and comparison, and the index keeps each entry's hash so growth never rehashes. | **Contradicts a decision:** hashing was to take a random seed per process (against hash flooding); main's hash is unseeded FNV-1a, and literal hashes are fixed at compile time. It also reads one character at a time. |
| **Objects and classes** | layouts, field access, interfaces, method calls | Fixed layouts per class, interfaces satisfied by shape, and a call through a value with at most two known classes becomes a direct call. | `instanceof` as a class-id range test, nullable fields: designed, not built. |
| **Arrays** | layout, growth, element sizes, bounds checks, typed arrays | Element widths and bounds facts; a compare no longer costs a field its array length. | A sort that moves elements without counting them: designed, not built. |
| **Functions as values** | closures, indirect calls | A closure is an object with one method; known-class calls are direct. | Sets of classes for fields and return values, splitting call sites, typed adapters: designed, not built. |
| **Dynamic values** | `any`, `unknown`, unions: a value carrying its type at run time | A 16-byte tagged value ([`../any-unknown.md`](../any-unknown.md)). | Revisit with untyped JSON, which needs a new representation for it. |
| **Memory management** | reference counting, cycles, stack frames, regions, reuse | One ownership answer per value, borrowed calls, objects placed in the frame, counts elided, an inline retain/release fast path, a cycle collector that skips acyclic types, call regions. | No single design ties these together; regions (stage C) stalled; reusing a value's memory in place (Perceus) is not built. *Study in progress.* |
| **Control flow** | exceptions, generators, async/await, the event loop | Mostly built ([`../async.md`](../async.md)); the event loop is chosen per platform. | Gaps such as `next()` on an async generator. |
| **RegExp** | the regular-expression engine | Not provided. | Decided: matchers generated at compile time for literal patterns, plus the TypeScript interpreter in `runtime/ecmascript` for dynamic ones. Needs the Unicode data. |
| **JSON** | parse and stringify | `JSON.stringify` writes each layout through a writer the compiler generates. `JSON.parse` is not provided (NTS1100). | Designed: a parser generated per static type for `JSON.parse(text) as T`, simdjson's scanner on native, a new representation for untyped values. |
| **Host boundary** | bytes, buffers, files, the network, C interop | C interop and the event loop are built. | Decided, not done: build libuv, zlib, brotli, zstd and OpenSSL from node's own sources instead of system libraries. One mechanism to declare which provider supplies each builtin on each target. |

Dates, time zones and Intl are built on these foundations. On JS hosts (Wasm in
a browser or node, Chromium) they come from the host.

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
| QuickJS `libunicode` | case conversion | to be replaced |

## Keep in mind: the JVM and Wasm

Not designed yet. What is already known:

- **The JVM** has its own garbage collector, so reference counting does not
  apply. Java's `String` already has nts's shape (one or two bytes per
  character). Strings are built by writing into the consumer. JSON gets a
  generated serializer and parser plus Java kernels; simdjson's Java port was
  measured and rejected.
- **Wasm, JS-hosted** (browser, node, Bun): may use the engine's strings, `Math`,
  JSON, RegExp and Intl. Open: reading characters through the engine's strings
  costs a call each (the `strings` row is 34x C), while the 2026-10-25
  direction keeps the host's strings in this profile.
- **Wasm, standalone** (Wasmtime, WASI): carries everything itself. Open: how its
  runtime pieces (number formatting, hashing, Unicode) are provided now that the
  compiler hands code straight to Binaryen ([`../wasm.md`](../wasm.md)).

## How this directory grows

Each foundation gets its own page when it is designed: what it is, its
representation per backend, what each operation costs, the decisions and why,
the benchmark rows it is held to, and what is still open. Memory management and
Unicode come first, from the two studies now running.
