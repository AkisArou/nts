# The decisions log

Every decision the user has made, with its date and, where quoted, the user's
words. Each one is also written into the page it governs, in that page's
`## Decisions` section, which is where it is read; this log is where it is
dated. A decision changes only when the user changes it: then the old entry
stays, marked superseded, with the new one beside it. The evidence behind each
is in [the records](..).

Dates are 2026.

## The bar

- **Performance is the reason nts exists:** beat node **and Bun** by a wide
  margin on every benchmark row, and come as close as possible to each target's
  own language: C++ for C and LLVM, C++ compiled to Wasm for Wasm, Java for the
  JVM (10-22).
- **"Performance and clean-code and best architecture is a must for our
  product"** (10-24). No hacks or workarounds standing in for a fix at the
  cause.
- **Nothing is fixed:** "we can refactor as much as needed, to reach our goal.
  Noone uses our project yet!" Slow ported code, runtimes or representations
  are replaced outright (10-22).
- **"Beats" means at most 0.8× of node's and Bun's time on a row,** for now;
  each row's bar is set again when that row is worked on (10-27).
- **Show every benchmark result** as it is produced: ratios against node and
  Bun, the machine's conditions, and the verdict, losing rows included (10-07,
  10-21).
- **Keep the user in the loop** on progress, especially benchmark and
  optimization results (10-24).

## Priorities and order

- **Primitives before test262** (10-22): test262 records keep gating, but no new
  test262 family starts until the foundations are solid. Now the
  [foundations](../../foundations) plan.
- **Native (C and LLVM) first** (10-22, confirmed 10-27): the JVM and Wasm are
  kept in mind and designed after native.
- **Land everything worth keeping before new work** (10-26): "whatever work is
  done by MainCodex, tsrs, tsrs-helper, compiler and runtime agents ... to be
  leveraged and land into main. When main settles, then we move to new
  implementations."
- **Features and conformance first; compile time is guarded, not chased**
  (10-07): a per-module compile-time tripwire in the gate, and super-linear
  blow-ups fixed when found.
- **A builtin must not mask a compiler gap** (10-23): a row that loses because
  nts compiles ordinary TypeScript badly is fixed at the general cause first;
  a specialized builtin comes after, on top.
- **A red that only affects the paused JVM does not block a landing** (10-26):
  it is recorded in `tooling/conformance/jvm-declines.known` and fixed after,
  in parallel.

## Team and process

- **MainClaude is the coordinator and head agent** from the end of the tsrs
  switch's gate (10-27): it decides, designs and reviews; the Codex agents
  implement and measure.
- **The earlier Codex work's archived branches** (`refs/archive/codex/...`) are
  a quarry: port an independent fix with its own fixture and gate; never land
  a branch wholesale.
- **Wasm (10-27):** `stringref` is rejected (W3), and erased values keep i31 for
  small integers (W4), from [the JVM and Wasm page](../../foundations/jvm-and-wasm.md);
  its other proposals wait for research.
- **Branch and worktree cleanup is the coordinator's call** (10-27): no need to
  ask. Landed branches are deleted; branches with unique work are archived
  (`refs/archive/...` plus an `archive.tsv` row), so nothing is lost; worktrees
  go when they are clean, idle and their branch is done. The Chromium checkout
  and that lane's branches stay.
- **Docs go straight to main** (10-27): the coordinator writes documentation
  in `~/Projects/nts` itself, with no docs branch or worktree, and commits it
  without a gate whenever no landing train is running. The user reads the docs
  there.
- **Landings are organized for speed** (10-27): changes that owe the full gate
  for hygiene reasons (comment sweeps over gate scripts, unmatched paths) are
  split from urgent work and scheduled into quiet windows.
- **Apple and Windows programs may stay unrun** when a landing's only refusals
  are their platform skips; fix platform issues when they surface (10-23).
- **Disposable under disk pressure:** `~/.cache/node-compile-cache` and a paused
  lane's build output; never an active agent's (10-23).
- **The git cleanup** (inventory, archive, delete) was approved and executed
  (10-23).
- **Upstream code stays as upstream wrote it** (node's tests, React,
  test262): a test nts cannot pass is a gap to report, never code to edit.

## Frontend: tsrs

- **tsrs replaces tsgo**, called in-process (10-22: "YES about tsrs!!").
- **"NO tsgo or tsrs --api intermediate steps"** (10-23): no staged switch, no
  tsgo bump, no digest comparison with tsgo; once validated, tsgo and its
  transport are deleted with no compatibility leftovers. _Supersedes_ the
  staged plan of 10-22.
- **Temporary local tsrs patch allowed** (10-24) to unblock the landing, for the
  two checker crashes, after first moving to the latest upstream tsrs; it is
  removed when an official upstream release fixes both. _Supersedes_ "no local
  patches to vendored tsrs" for that case only.

## Builtins and runtimes (10-22)

1. Intl is in scope, with locale subsets keeping it small.
2. The clock and randomness (`Date.now`, `new Date()`, local time, `Math.random`,
   `performance.now`, `crypto.getRandomValues`) come from the environment,
   with a virtual clock and seeded randomness under the differential tests.
3. On JS hosts (Wasm in a browser or node, Chromium) take the host's builtins,
   starting with Intl and RegExp; on native and standalone Wasm use ours. Each
   feature is chosen by its benchmark row and conformance record.
4. `WeakRef` and `FinalizationRegistry` are represented, not designed around.
5. RegExp: matchers generated at compile time for literal patterns, plus the
   TypeScript interpreter for dynamic ones and as the oracle. No second native
   engine.
6. Apps may override a provider in `nts.config.ts`, but only with a provider
   that has a conformance record.
7. `typeof X === "undefined"` folds where a target lacks X.
8. `node:*` APIs are native-only for now, and never in a Chromium renderer.
9. Only `@nts/*` packages provide `es:*` and `web:*` features; third-party
   packages may provide `host:*` capabilities and their own modules.
10. The canonical `URLSearchParams`, `Blob` and `File` are web-platform's;
    runtime/node re-exports them.
11. Types: one full lib (ESNext plus DOM), with the NTS1100 "not on this
    target" error, not per-target libs.

## Numbers and JSON (10-22)

- **CPU level:** native x86-64 builds default to x86-64-v3 (AVX2), with a clear
  error on an older CPU, a portable opt-out (`cpu: "baseline"`), run-time
  dispatch kept in vendored SIMD kernels, 32-byte array alignment, and
  `-ffp-contract=off`.
- **`Math` is bit-identical to node:** ship V8's fdlibm-derived `ieee754`.
- **BigInt past 128 bits:** wrapping 64-bit now (`asUintN(64)`), real bignums
  after. _The code went further:_ BigInt is exact to 128 bits on every
  backend, and a result past 128 bits stops by name.
- **Benchmarks build exactly as `nts build` does,** and `nts build` uses ThinLTO.
- **`JSON.parse(text) as T` that does not match `T`:** a `TypeError` naming the
  JSON path; invalid JSON is always a `SyntaxError` first.
- **Key order and undeclared keys** are kept only where the program can observe
  them.
- **A class as `T`** in `JSON.parse(...) as T` is refused for now; plain object
  types only.
- **simdjson's C++ runtime is linked statically** (about +0.6 MB per program).
- **Our own structural scan** for non-ASCII strings, beside simdjson's.
- **No nesting-depth limit** beyond memory.

## Memory and vendored code (10-22, 10-23)

- **NoGc is for testing only** ("I do not think anyone should ship like this");
  shipped native programs count references.
- **Region clones** are fine where a benchmark row pays for them, with a
  code-size check.
- **Acyclic types are proved, never declared** (10-23): no user-visible or
  internal acyclic marker.
- **C++ in a vendored corner of the runtime,** with no C++ standard library
  linked (an exception for Intl: D3 below).
- **The text codec's size:** aim for +51 KB with LTO, at most about 200 KB.
- **Vendored sources are baked into the `nts` binary;** no network at build
  time.
- **ICU:** locale subsets by default, full data opt-in.
- **OpenSSL 3.5 is vendored,** replacing the system libcrypto.
- **The TypeScript URL and HTTP parsers stay** for now, with ada and llhttp as
  C++ references in benchmark rows; replaced only where a row loses.
- **nts never depends on a system package;** a missing toolchain package is
  installed with `paru`.

## Objects (10-22)

- **String hashing takes a random seed per process,** against hash flooding.
  _Not yet true on main_: see the [map](../../foundations/README.md).
- **Map and Set tables compact deleted entries,** with a list of live cursors
  so iteration stays correct.

## Strings (10-22)

The string design was approved: the microbenchmark matrix first, then the
number formatter, destination passing, allocation, the header (hash and
flags), the escape primitive, Wasm strings, parse regions. Never UTF-8
storage; no run-time ropes unless a row proves them.

## Wasm (10-24, 10-25)

- The question asked was "if our Wasm compiler is not faster than LLVM-IR ->
  wasm, we can ditch our wasm and use emscripten", with the pros and cons of
  each approach.
- **The answer:** one WasmGC backend, browser-first (DOM and JS integration as
  the first milestone), with JS-hosted and standalone profiles. The compiler
  hands code directly to Binaryen, which does the optimizing; linear memory is
  only for buffers and kernels ([`wasm.md`](../../targets/wasm.md)). No backward
  compatibility with the current emitter is owed.
- test262 runs on every backend, the JVM and Wasm included (10-14).

## Unicode (10-27)

From [`foundations/unicode.md`](../../foundations/unicode.md):

- **D1:** the compiler owns the Unicode data, generated from Unicode's own
  files.
- **D2:** the Unicode version is node's.
- **D3:** Intl on native uses ICU4C, with a static C++ standard library only in
  programs that use Intl.
- **D4:** the JVM uses nts's tables.
- **D5 (amended the same day):** the word-break dictionaries ship whenever a
  program uses word segmentation, unless its input is proved free of those
  scripts, because ICU picks a dictionary from the text, not the locale.
  _Superseded:_ "word-break dictionaries only for declared locales".
- **D6:** no Intl on standalone Wasm for now.

QuickJS goes entirely (10-22).

## Memory management (10-27)

From [`foundations/memory.md`](../../foundations/memory.md):

- **M1:** one analysis before counting gives every allocation site one home;
  R4(b) is redirected into it, and our JSON parser's shared placeholders
  become `null`.
- **M2:** workers are isolated heaps with non-atomic counts, permanently.
  Sending without a copy, by a proved move or frozen sharing, may come later.
- **M3:** weak references follow the specification exactly.
- **M4:** mimalloc is tried first as the native allocator.
- **M5:** no memory annotations in the language.

## Language and hosts (10-27)

- **`globalThis`, `Proxy` with `Reflect`, and object integrity**
  (`Object.freeze`, `seal`, `preventExtensions` and their predicates) are in
  scope, deferred. _The coordinator reads "etc." to include_ the
  property-descriptor family (`Object.defineProperty`, `defineProperties`,
  `getOwnPropertyDescriptor`, `getOwnPropertyDescriptors`), since `Reflect`
  and the integrity levels are defined in terms of it. Each is to cost nothing where a program does not use it,
  with the compiler proving which values a use can reach
  ([open questions](../../open-questions.md) L24 to L26).
- **An exception that escapes a callback a host invokes** (a GTK signal, a
  WinRT event, a C function pointer, a timer) is the program's uncaught error,
  and the target decides what that does. _Decided by the coordinator, on the
  user's delegation._
  - On a command-line program it is printed as node prints it, and the process
    exits with status 1.
  - In a Node addon it crosses into node as a JavaScript exception, so node's
    own rules apply.
  - On UI targets (GTK, Apple, Windows UI, Chromium) it is reported with the
    same text, and the event loop keeps running, as browsers and GJS do.
  - A handler can observe it: `process.on("uncaughtException")` where
    `node:process` is provided, the web's `error` event elsewhere.
  - It never unwinds through the host's frames: the boundary catches it. A
    callback that must return a value to the host, and throws instead, is
    fatal on every target, since no value can be made up.
  - An unhandled promise rejection follows the same split.

## Lanes (09-23, 09-24)

- **Apple (09-23, 09-24):** macOS and AppKit first, iOS later. A Swift-shaped
  surface replaced the NativeScript-shaped one (09-24). There is no Mac
  hardware and no hosted CI: a local quickemu VM.
- **Windows (09-24):** Win32 first, then WinRT and COM, then WinUI 3. The
  mingw ABI through zig now, MSVC later. A quickemu Windows 11 VM; nts itself
  never runs on Windows.
- **React (09-24):** React gets its own runtime with typed internals; upstream
  React is the reference and the oracle only, never shipped.

## test262 (09-29, 10-02)

- **Done** means every ECMA-262 strict-lane file passes or sits under a named
  permanent boundary.
- **The permanent boundaries** are property descriptors, the metaobject
  protocol, the global object and realms, and three Symbol redirect hooks
  (`Symbol.toPrimitive`, `Symbol.hasInstance`, `Symbol.unscopables`).
  _Partly superseded 10-27:_ `globalThis`, `Proxy` with `Reflect`, object
  integrity and the descriptors they are defined by are in scope (Language and
  hosts, above).
- **Module tests** are in the lane (10-02), reversing 09-29.

## Wasm exports (10-14)

- **Objects cross an exported boundary by proof:** copied where the copy is
  invisible, live otherwise, through a cached wrapper; typed-array bytes are
  borrowed; never a silent copy
  ([record 0356](../0356-objects-cross-an-exported-boundary-by-proof-copied-where-invisible-live-otherwise.md)).
