# 0361 — Calling C from a header

**Decided 2026-10-30, by the user, on the coordinator's research.**

A TypeScript program calls a C library through a binding that is the C API
exactly as the library's header declares it, written with TypeScript's
values. Nothing beside the header states what a function does with its data,
so the binding promises what C promises and the program keeps C's
obligations; nts adds every check it can make without that knowledge. Refined
APIs are written over a binding as TypeScript packages, or come as Node-API
addons. The specification is [Calling C](../targets/calling-c.md); the
reports, the coordinator's checks and the experiments are in
[`notebooks/c-interop-research/`](notebooks/c-interop-research/README.md).

## The question

The user asked whether `local<T>()` was needed at all ("can't we just
`const something = {...}`?"), and then whether everything a friendlier
interface needs could be generated without a developer declaring it.

## What a header can say, measured

- **Annotations are rare.** The zlib, libuv, SQLite and curl headers in
  `/usr/include` carry none of nullability, `nonnull`, `noescape`,
  `counted_by`, the ownership attributes or GCC's `access` and `malloc`.
- **glibc's facts are hidden from clang.** `gcc -E` shows `write`'s
  `access(read_only, 2, 3)` and `fopen`'s `malloc(fclose, 1)`; `clang -E` shows
  neither, because glibc emits them only for GCC 10 and 11 and later. Clang
  23.1.3 drops `access` as unknown, ignores `malloc(deallocator)`, and refuses
  `counted_by` on a parameter.
- **Clang keeps** `nonnull`, the nullability qualifiers, `noescape`,
  `ownership_returns`, `ownership_takes` and `counted_by` on a struct field.
- **Published metadata is complete where it exists:** this machine has 131
  GObject Introspection files, which state ownership, outputs, nullability,
  array lengths, callback scopes and errors.
- **The C compiler proves some facts from a library's own code, soundly but
  partially.** On node's bundled zlib, linked whole and optimized, LLVM
  proved "not kept" for 59 of 91 public pointer parameters (65%) and
  read-only or write-only for 37 (41%). It missed `compress2`'s and
  `crc32`'s buffers, and proves nothing about who frees what, which return
  value means failure, or which count belongs to which pointer.

## What the research found

Four reports cover nts's own code, ten other toolchains, JavaScript runtimes,
inference research and a catalogue of 243 real API entries. No toolchain
derives ownership, retention or error conventions from a plain header, and
the research tools that try are unsound or incomplete by their authors'
account. The reports agree that nothing may unwind through C frames, that
unknown nullability must not become non-null, and that errors are a
per-function protocol with errno read at once.

## The options

1. **A generated interface over a per-library file of facts.** The first
   proposal: each library gets a notes file stating what its header cannot,
   and nts generates an idiomatic interface from it. The user rejected it:
   "It needs extra metadata."
2. **The C API as it is, written with TypeScript's values.** The user: "the
   developer would expect the same API like it is in C, but write it with
   JS/TS semantics." Chosen. Rust's ecosystem works this way (generated
   `-sys` crates, safe crates written by hand), and Swift, Zig, Go, Deno and
   Bun all call C's API as it is.

## Why each rule is what it is

- **A struct object is C memory at a fixed address,** because C may keep a
  struct's address between calls (zlib's `z_stream`, every libuv handle), and
  without metadata nts cannot tell which functions do. A fixed address also
  means no hidden copies. Vala, which also compiles to C, places a struct
  passed by pointer in the caller's frame the same way.
- **A nested struct is a read-only reference into its parent.** Python's
  ctypes hands out nested fields as views, so swapping two of them overwrites
  both (its documentation's "Surprises"). Making the field read-only turns
  that into a compile error, while reads keep JavaScript's reference meaning.
- **`Ref<T>` for out-parameters,** because TypeScript cannot see C write to a
  variable. With `let db: Db | null = null; open(addrOf(db))`, TypeScript
  7.0.2 still treats `db` as `null` afterwards and reports `TS2339: Property
  'size' does not exist on type 'never'`; the `Ref` form type-checks. Julia
  uses the same name for the same job.
- **`addrOf` only as a direct argument,** so no stored pointer outlives the
  object it points into. Dart has the same rule.
- **A string is valid for the call,** the contract of Swift, Go and node's
  `node:ffi`. The few functions that keep a string (`putenv`) take `cstring`.
- **An exception escaping a callback ends the program,** because C has no
  exceptions: continuing C after a failed callback leaves it working on what
  it believes the callback did. Rust, Java and .NET end the process too.
- **Every pointer is nullable unless the header says otherwise,** which is
  C's own rule. Kotlin treats an unknown result the same way.
- **`errno()` is saved as each call returns,** because nts's runtime may call
  C before the program reads it; Java's `captureCallState` exists for the
  same reason.

## `node:ffi`

Node 26.1 added `node:ffi`, which shares the choices above that were
contested: strings converted for the call, buffers borrowed for the call,
64-bit values as `bigint`, callbacks that must not throw and must run on
their own thread, ownership left untracked, and `using` on the library
handle. It has no structs, arrays, variadic calls or errno, so it is nts's
bridge for compatibility and for comparing C interop with node, not its main
surface. The node reference moves to Node 26 for it.

## What this changed

- B-1's overrides file is gone: `bind-c` binds whole headers directly.
- I-5's ResourceFlow keeps the ownership facts that metadata states. For
  plain C its work is the checks of the specification.
- `local<T>()` is removed. The fact tags remain only where a platform's
  metadata generates them.

## Gaps found in the code as it stood

| gap | checked |
|---|---|
| strings lent in place with no "not kept" fact, so a `putenv`-like callee reads freed memory | in code |
| non-null pointer and handle results unchecked, and `bind-c` declaring every pointer non-null | consistent with `bind.rs` |
| `long long` spelled `int64_t`, a different C type on Linux | mapping in code; the witness failure inferred |
| `static inline` functions bound as symbols, which LLVM builds cannot link | inferred |
| bigint constants read as doubles, rounding past 2^53 | inferred |
| `Counted` passing only element counts | from the inventory |
| the owner-thread check passing when no host is installed | from the inventory |
| `OnceClosure` leaking when C rejects a request and never calls | from the catalogue and the inventory |
| `runtime/native/README.md`, `native.md` and `c-headers.md` out of date | from the inventory |
