# C interop research, 29 and 30 October 2026

The evidence behind [record 0361](../../0361-calling-c-from-a-header.md) and
the specification [Calling C](../../../targets/calling-c.md).

| File | Author | What it covers |
|---|---|---|
| [`nts-inventory.md`](nts-inventory.md) | a Claude research agent, reading main at `c5549ea5a` | nts's C interop by concept (built, decided, open), 14 contradictions between docs and code, and 18 facts trusted without a check |
| [`survey-a.md`](survey-a.md) | a Claude research agent | Swift 6.4, Rust 2024, .NET 10 and Java 25's FFM API, from primary sources |
| [`survey-b.md`](survey-b.md) | a Claude research agent | Go 1.27, Zig 0.17, Kotlin/Native 2.4, Dart 3.13, Vala 0.56 and Nim 2.4, and the annotation vocabularies (clang's bounds-safety and nullability, GCC's attributes, SAL, win32metadata, GObject Introspection), with tests against clang 23.1.3 and GCC 16.2.1 |
| [`chatgpt-report.md`](chatgpt-report.md) | ChatGPT, verbatim | A: JavaScript runtimes and dynamic languages; B: inferring facts from code and documentation, with the authors' own numbers; C: a catalogue of real C API patterns over 243 entries in 9 libraries |
| [`node-ffi.md`](node-ffi.md) | the coordinator | Node 26's `node:ffi`, and how nts could use it (kept for later) |
| [`audit.md`](audit.md) | a Claude research agent, reading main at `c5549ea5a` | the accepted design audited before it was written down: 4 blockers, 12 should-fix, 9 minor, with its TypeScript and node probes |
| [`experiments.md`](experiments.md), [`zlib-pointer-params.tsv`](zlib-pointer-params.tsv) | the coordinator | clang's view of header annotations, LLVM's proofs on a small library and on zlib, and TypeScript's view of an out-variable |

## Where the reports agree

- **No tool gets ownership, retention or error conventions from a plain
  header.** None of the ten toolchains surveyed infers them from a library's
  code; the research tools that try are unsound or incomplete by their
  authors' own account; LLM extraction of allocator contracts from
  documentation scored precision and recall of 0.63 and 0.86, and 0.46 and
  0.56, on its two allocator cases.
- **LLVM's own proofs are sound but partial:** on zlib, "not kept" for 59 of 91
  public pointer parameters and read-only or write-only for 37, missing
  `compress2`'s and `crc32`'s buffers.
- **Exceptions never unwind through C frames.** Rust, Java and .NET end the
  process; Deno, Koffi and cffi hand C a zero and, in Deno's case, raise the
  exception after the call returns; Dart makes the program state the value C
  receives.
- **Unknown nullability must not become non-null,** and **errors are a
  per-function protocol** with errno read at once.
- **The two contracts for a pointer** are "valid for the call" (Swift, Go,
  node:ffi) and "kept until a named event" (Windows metadata's `[Retained]`,
  SQLite's `SQLITE_STATIC`).

## What each report changed

- **The inventory** showed how much nts already has (the closure kinds,
  lent strings and buffers, `@ntsFree`, `@ntsThrows`, counted families) and
  found the gaps listed in record 0361.
- **Survey A** set the vocabulary for errors (Swift's `swift_error`, Java's
  `captureCallState`), nullability (three states) and handles (Swift 6.2's
  annotated C types, Rust's fallible `close(self)`).
- **Survey B** found that upstream clang cannot read counts on parameters, or
  glibc's GCC-only deallocator and buffer attributes, and supplied Vala's
  frame placement, Dart's `exceptionalReturn` and `.address` rule, and Nim's
  move-only handles as precedents.
- **ChatGPT's report** found the ctypes nested-field trap, which made nested
  struct fields read-only references. It also found the release outcomes
  (`sqlite3_close`, `sqlite3_finalize`, `sqlite3_close_v2`, `uv_close`),
  argument-dependent ownership (`getcwd`, `sqlite3_bind_text`, curl's options),
  buffer relations stored in structs or set by other calls, and the callback
  cases (rejected submissions, calls before registration returns or during
  cleanup).

## Claims the coordinator checked

| Claim | Where | Result |
|---|---|---|
| `sqlite3_close` returns busy and leaves the connection open; `close_v2` is "intended for use with host languages that are garbage collected" | sqlite.org/c3ref/close.html | verified |
| ctypes nested fields are views, and the swap overwrites both | Python 3.14 ctypes docs, "Surprises" | verified |
| Deno gives C a zero and the exception surfaces after the call | Deno's `ext/ffi/callback.rs` (the docs are silent) | verified in code; callbacks returning `isize`, `usize` or a struct reach `unreachable!()` when they throw |
| a rejected `uv_queue_work` runs no callback | docs.libuv.org threadpool page | not stated there |
| glibc's attributes are hidden from clang | `clang -E` against `gcc -E` | verified |
| zlib, libuv, SQLite and curl headers carry no annotations | `/usr/include` | verified |
| the inventory's gaps 1 and 3 | nts source | verified in code |
