# The decisions log

Every decision the user has made, with its date and, where quoted, the user's
words. Each one is also written into the page it governs, in that page's
`## Decisions` section, which is where it is read; this log is where it is
dated. A decision changes only when the user changes it: then the old entry
stays, marked superseded, with the new one beside it. The evidence behind each
is in [the records](..).

Dates are 2026.

## Measurement admission takes memory and CPUs together (11-10)

Issue #640: a measurement waiting behind the nightly benchmark held an unused
memory reservation for hours. CPU tickets now retain priority and arrival
without a memory promise. A ready ticket enters the memory queue; under the
ledger lock the memory decision takes the CPU mutex nonblocking only if
memory fits. A CPU-blocked ticket leaves the memory queue, and quiet-core
observation holds neither resource. The nightly calls the wrapper directly
with its key. The legacy directory mutex remains compatible with measurements
running older commits. The owning shell keeps the joint grant through its
payload and releases the mutex on exit.

## Unmeasured jobs use live accounting (11-10)

Issue #641: an unrelated job's measured peak is not a forecast for an
unmeasured job. Its first run asks for the margin on its current use; while
it runs, ledger decisions charge current use and that margin. The watcher
records its peak for the next run, including when a unit ends its remaining
processes after the command exits. Measured jobs keep their existing peak
reservations. Live descendants draw on a fixed ancestor's unused forecast
as their use changes, while a live ancestor promises no unused forecast.
The prepared-HIR comparison, instruction counts and five test262 records
use the stable keys hir-compare, perf-count and test262-records.

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
- **The bar names the ahead-of-time compilers** (10-29): "faster than node,
  faster or at least tie with scriptc and bun aot". Bun's JIT stays a
  must-beat column, like node, at 0.8×. A tie with Bun AOT or ScriptC "should
  be row dependent I think. Nonetheless I think ~5%". The bar does not end the
  work on a row: "we should always investigate what we can do better,
  leverage profiling tools", and "beating node matters ofcourse, but beating
  ourself matters too!"
- **Every benchmark run is kept** (10-29): the user found
  `results/benchmarks/` stale and proposed "full.md always populated with the
  latest run, and keep an json file or something, with all runs with the
  appropriate metadata"; agreed with the coordinator's refinement of one
  immutable record per run rather than one growing file, so parallel landings
  do not conflict and each run can be cited. `full.md` is rendered from the
  newest complete run with nts's own best per row
  ([workflow](../../workflow.md#decisions)).
- **Losses are expected while the compiler is unfinished** (10-29): "we might
  lose, but we have to profile and see why, note it, and possibly
  add/update/modify the plan." Each loss is profiled, its cause recorded, and
  it is mapped to the plan item that covers it; the plan changes where none
  does.
- **Show every benchmark result** as it is produced: ratios against node and
  Bun, the machine's conditions, and the verdict, losing rows included (10-07,
  10-21).
- **Keep the user in the loop** on progress, especially benchmark and
  optimization results (10-24).
- **"We should leverage the typescript compiler and static analysis as much
  and as sane we can"** (10-27). What the checker knows is the first source of
  facts; where TypeScript is unsound by design, the compiler proves the fact,
  checks it at run time, or refuses.
- **A fix that adds a run-time cost asks what the compiler could prove
  instead** (10-29). The merge-bound fix put back bounds checks that a wrong
  proof had removed. The user asked to "be smarter where, when and how we
  place those checks", leveraging TypeScript's static analysis, then made it
  part of the coordinator's role: "when something needs 'fixing' like this
  case with the bounds case, always wonder what we can do to leverage the
  compiler and be optimized". The fix still lands first, since a check a wrong
  proof removed is a memory-safety hole; the proof that would remove the cost
  is recorded as an idea or a plan item. The bounds ideas are in
  [bounds-check placement](bounds-check-placement.md); the role is in
  [workflow](../../workflow.md).
- **An obvious winner is built first** (10-28): where a faster
  implementation is obvious or much expected (SIMD, a native library, code the
  compiler generates per type), it is the first one built, not a later
  replacement for a slower one. "We should be AS FAST AS POSSIBLE! as close
  to C/C++ and beat node/bun by the biggest margin we can! Again, I am saying
  that only if something is obvious/much expected." Applied the same day:
  `structuredClone` and `console`'s walk over a typed value are generated per
  type; UTF-8 and base64 conversions are SIMD in `runtime/c`; compression
  goes through a vendored library ([builtins](../../foundations/builtins.md#which-kind-of-provider)).
- **Always the best architecture** (10-28): when the right design is known,
  build it, never an interim step inside the wrong one. The coordinator had
  staged a faster `Map` getter that kept numbers as boxed doubles, with the
  layout change left for later. The user: "if we know that an unnecessary
  conversion is happening, why ignore it?", then "Please follow this
  principle from now on. always best architecture." Applied at once: maps
  are stored by the proven layout of their values, raw int32 where the
  values are proved int32, with boxed values only where they are genuinely
  dynamic. The rule is now at the top of `AGENTS.md`.
- **Apple's SDKs are used only on Apple hardware** (10-28; the user asked the
  coordinator to decide): bindings are generated on a Mac or a hosted macOS
  runner, and only nts's generated declarations reach other machines. Zig
  carries the C library's headers, not the frameworks', so it does not change
  this.

## Priorities and order

- **Silent wrong answers first, wherever they are found** (10-28): a program
  that compiles and computes a wrong result comes before any refusal, and
  refusals follow in the order of how much real code they block. Asked
  whether the TypeScript suite's new soundness cases take precedence over
  test262, the user agreed with that ordering ("ok perfect"): the soundness
  wrong answers come first, and test262's wrong results stay pinned by its
  records until the foundations reach them.
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
- **The direct Wasm implementation is removed** (the user, 10-27): it is removed from
  the tree, the workspace and the gate, and archived at
  `refs/archive/wasm/direct-backend`, rather than kept in the tree unbuilt.
  The Binaryen backend replaces it later and starts from the design. Until
  then, fixtures and agreement cover C, LLVM and the JVM, and the gate loses
  the Wasm steps, which were often the longest step of a core train.
- **WebAssembly is a target and always will be** (the user, 10-28):
  "WebAssembly IS a target and will always be, like before. we just deleted
  the previous implementation because we are gonna build it on top of
  binaryen-IR". The 10-27 removal was of the implementation, not the target.

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
- **Build order** (MainClaude, from the stage 1.1 profile): `release-acyclic`
  moves from stage 1 to stage 3. After release by type, its drain is mostly
  loading each dying object's header and descriptor, and the explicit list
  work is about 6% of the run, so no drain change closes its gap with node.
  The profile is in `~/.cache/nts-scratch/runtime-20261027/typed-release-ab/profile/split.md`.
- **M6** (the user, on MainClaude's recommendation): the cycle collector stays
  trial deletion; its next step is measurement only, and an exact tracing
  backstop waits until stages 2 and 3. After typed visitors, `cyclic-churn`'s
  collection pass is 42–46% of its cycles, and even removing all attributed
  collector work would leave it about 3× node. The options page is
  `~/.cache/nts-scratch/runtime-20261027/m3-collector-options.md`.

## Language and hosts (10-27)

- **When a type's claim is false at run time** (register L6, with L4): an
  erased value (from `any`, `unknown`, JSON or foreign code) asserted to a
  type it does not have throws a catchable `TypeError`, the one documented
  difference from node, as Static Hermes does and as the JSON.parse decision
  of 10-22 already says. Everything else TypeScript gets wrong (holes,
  uninitialized fields, reads past the end) behaves exactly as node does.
  Chosen: "Catchable TypeError".
- **Any refusal fails `nts build`** (register L20); a `--partial` flag still
  writes the cut program for experiments, marked as such. Chosen: "Fail, with
  an opt-in flag".
- **`globalThis`, `Proxy` with `Reflect`, and object integrity**
  (`Object.freeze`, `seal`, `preventExtensions` and their predicates) are in
  scope, deferred, and so is the property-descriptor family
  (`Object.defineProperty`, `defineProperties`, `getOwnPropertyDescriptor`,
  `getOwnPropertyDescriptors`), on which `Reflect` and the integrity levels
  are defined ("yes, descriptors included"). Each is to cost nothing where a program does not use it,
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

- **The dynamic features come later:** "we should include those dynamic
  features later, with great care for performance. First lets tackle the solid
  typescript things as we did up until now. at some point when we feel
  confident that those dynamic features wont pollute our performance oriented
  static design, we discuss." Their test262 cases stay excluded until then.
- **A function's source text** (L27): kept only for functions whose
  `toString` the compiler can see is called, so no other program pays for it
  ("go with L27 as recommended").

## Builtins mechanism (10-28)

- **The builtins design is approved as a whole** (register G1,
  `foundations/builtins.md`): "I agree to all docs/foundations/builtins.md!".
  Asked why a package declares what it provides in `package.json` rather than
  in `nts.config.ts` per target: what a package can provide belongs to the
  package and must be readable as data without running any dependency's code
  (most providers have no `nts.config.ts`); each target's preference is its
  profile's; an app's own choice is its `nts.config.ts` override.
- **WinterTC's Minimum Common Web API is the web floor on native and the JVM**
  (register G5, G7): "I agree about WinterTC's Minimum Common Web API!".
- **The floor includes the `WebAssembly` JavaScript API** (register G5, G7,
  added later the same day): `compile`, `instantiate`, `validate`, `Module`,
  `Instance`, `Memory`, `Table`, `Global` and the error types. On native and
  the JVM, a program that uses it gets an embedded Wasm engine, chosen under the
  dependency policy (register D-1) and linked only into programs that reach
  `WebAssembly`, so programs that do not pay nothing. It comes last in the
  web-floor work. Asked whether to leave it out of the floor, the user
  answered "Yes we want that!", keeping it in.
- **One package per spec family:** `es:*` in `runtime/ecmascript`, `web:*` in
  `runtime/web-platform`, `node:*` in `runtime/node`; JSON and `URL` move
  accordingly: "they should move to the appropriate dirs".
- **No WebSocket server:** asked why nts had one, the user answered "drop it
  entirely". No specification nts follows defines a WebSocket server: the
  WHATWG WebSockets Standard defines the client, WinterTC's Minimum Common Web
  API has no server APIs, and node ships only the client. A program that
  serves WebSockets uses a library for it ("something like uWebSockets"). The
  server code in `runtime/web-platform/src/websocket` came with the original
  web-platform delivery, whose integration plan called a public server "a
  required Node/server extension"; this replaces that line. The client
  (`WebSocket`, `WebSocketStream`) stays; its conformance tests need a peer to
  talk to, and that is decided with the tests, not provided by the runtime.
- **The WebSocket client's test peer is the `ws` package,** a dev dependency
  of the test tree that no compiled program links. It replaces the removed
  server code as the WebSocket peer of the WPT resource server. Asked, the
  user answered "Yes I am ok with the ws dev dependency".
- **`runtime/node`'s C becomes TypeScript** (10-29, agreed in principle; its
  plan is made next): the user proposed replacing the hand-written C under
  `runtime/node` with TypeScript that nts compiles, keeping C only in
  libraries such as OpenSSL, "this way we can dog-food our compiler, in a real
  world project", and agreed ("I agree with what you said!!") to this shape:
  the `node:*` glue becomes TypeScript calling the libraries built from node's
  sources; `runtime/c`, the language core it relies on (reference counting,
  allocation, the cycle collector, object and string representations), stays
  C for now; C remains only for third-party libraries, that core, and a
  primitive a benchmark proves faster in C, whose gap the compiler then closes.
  It needs typed bindings generated from the libraries' headers, ownership of
  their handles and callbacks from C into TypeScript first; then each module
  moves with node's own tests and its benchmark rows, deleting its C.
- **Brotli and Web Crypto's Modern Algorithms are scheduled.** Asked whether
  each is in its specification and whether node or Chrome supports it, the
  user answered "If so, yes we should schedule it and add it to our plan for
  implementation whenever you think we should". `"brotli"` is a
  `CompressionFormat` of the WHATWG Compression Standard; node accepts it from
  v24.7.0 and v22.20.0, and Firefox ships it. The Modern Algorithms are a WICG
  extension of the Web Cryptography API. Node implements it from v24.7.0
  (ML-KEM, ML-DSA, SHA-3, cSHAKE, AES-OCB, ChaCha20-Poly1305, `getPublicKey`,
  `supports`), adding KMAC and Argon2 in v24.8.0, TurboSHAKE and KangarooTwelve
  in v25.9.0, and hybrid KEMs in v26.10.0; Chrome is still experimenting with
  it. Its scope in nts is what node implements. Both are native, over the
  brotli and OpenSSL that nts builds from node's sources.

## Contributors and packages (10-28)

- **nts's licence is Apache-2.0 WITH LLVM-exception,** LLVM's exact licence:
  nts's own code compiled into a program (its runtime) owes nothing there, so
  a program that links nothing third-party owes no notice at all. Third-party
  components a program links (libuv, OpenSSL, ICU) owe their own notices,
  which `nts build` is to write for exactly what it linked; at equal quality,
  a component whose licence needs no notice in programs is preferred. Asked
  whether Apache-2.0 is the best licence, and whether users must ship notices
  anyway, the user chose this. The copy of Apple's SDKs on the shared machine
  is kept for now.
- **Cloud agents contribute through pull requests,** starting with the
  WinterTC floor's missing APIs in `runtime/web-platform`: plain TypeScript
  implementing published specifications, tested under node; a local agent
  compiles each with nts, gates and lands it. The user proposed ChatGPT for
  "typescript library code" in `runtime/{ecmascript,web-platform,nodejs}`,
  and chose the WinterTC gaps over `runtime/sdk` as the start.
- **No GPL code in the repository** (the coordinator, asked by the user to
  decide): sources nts carries are permissively licensed. Octane's Box2D
  port came with Octane's GPL-2.0-or-later driver around the zlib-licensed
  engine; the engine stays, the driver is replaced with an original scene.
  The rule is in `docs/contributing/cloud-agents.md`.
- **A second cloud task takes the Web Cryptography API** (the coordinator,
  asked by the user for a second, larger cloud task): its specification
  steps (algorithm normalization, key formats, usages, errors, the
  `CryptoKey`'s slots) are shared TypeScript in
  `runtime/web-platform/src/crypto`, over a primitive interface,
  `host:crypto`, that OpenSSL and the JCA implement; its test is WPT's
  `WebCryptoAPI` at the revision node 24.20 vendors. RegExp and Temporal
  were too far along to need one: on the host, RegExp passed 1,874 of
  test262's 1,896 RegExp tests that day, and Temporal's recorded result is
  4,567 of 4,603.
- **`runtime/sdk` becomes `runtime/app` (`@nts/app`):** its web-standard
  parts (`Notification`, the Async Clipboard, Web Share, Geolocation, the
  sensors) move to `runtime/web-platform` as `web:` features, with each
  platform's part a `host:` capability in its runtime; its lib subset is
  retired (decision 11); what no standard covers (the photo library, document
  grants, background tasks, scheduled notifications, secure storage, contacts,
  calendars, haptics, desktop windows and the tray) stays as nts's own
  application API, `@nts/app`. Asked where notifications belong, the user
  chose this over a `runtime/dom`: the DOM is the document tree, which these
  APIs are not.

## Compiler settings (10-28)

- **A program compiles only under `strict`** (register L8): every flag
  `strict` turns on must be on in effect, whether set through `strict` or one
  by one, and a project with any of them off is refused, naming the flags and
  the tsconfig that sets them. Asked "Require `strict` in a project's
  tsconfig?", the user answered "Yes, strict!".

## Language (10-28)

From the open-questions audit; each is the register's recommendation unless
the entry says otherwise.

- **The specification decides the language, and node what it leaves to the
  host** (register L23). test262 settles what a program means; node settles
  node's APIs, `console`'s format, timer order and the report of an uncaught
  error. Where node lacks a feature the specification has (proper tail calls,
  `Temporal`), nts provides it, so code that works on node behaves the same
  and some programs that fail on node run. Asked which oracle wins when
  test262 and node disagree, the user answered "I guess we should probably
  follow the real js specs, right?". _Revises_ the register's recommendation,
  which was node.
- **Proper tail calls are implemented** (register L3), as L23 implies: a self
  tail call becomes a loop; other tail calls are guaranteed tail calls (LLVM's
  `musttail`, clang's attribute in C), with trampolines where a backend has
  none (the JVM); stack traces omit tail frames, as Safari's do. _Revises_ the
  register's recommendation, which followed node and left them out of the
  denominator.
- **`eval` and `new Function` of run-time strings are a permanent boundary**
  (register L1). Source the compiler proves constant may be compiled later, as
  an optimization; the `eval` tests leave test262's denominator.
- **The `arguments` object is implemented,** unaliased, as strict mode has it
  (register L2).
- **Member reads on `any` and `unknown` by a run-time key** are supported
  (register L7): a table of member names per type, read through the value's
  run-time descriptor, while typed code stays direct. This unlocks untyped JSON
  and npm JavaScript.
- **Decorators are refused by name** until the TC39 standard semantics are
  implemented, later (register L10).
- **JSX is compiled in the compiler's core,** for any JSX library and not only
  through React's transform, with TypeScript's own JSX emit as the oracle
  (register L10).
- **Namespaces holding values, and declaration merging,** are implemented as
  TypeScript emits them (register L11).
- **Run-time identity matches JavaScript** (register L12): a class object per
  evaluation, `o.m === o.m` by caching method values per class, `new.target`,
  `#x in o`.
- **`declare` names something the environment provides,** through a builtin
  provider; C functions are reached only through explicit `c:` imports
  (register L13).
- **Everything JavaScript throws is catchable** (registers L14, L15): a raising
  flag on every indirect call, as Swift has, and stack exhaustion as a
  `RangeError`, its cost measured first (L14's research stays open).
- **Generators, the iteration protocol and `using`** get the full protocol,
  built in phase 3 (register L16).
- **Top-level `await`, `import.meta`, and JSON and text modules** are
  implemented (register L17), with `import.meta.url` as `bun build --compile`
  defines it, which is checked first.
- **Sources are strict ES modules** (register L18): CommonJS dependencies come
  in through an interop layer, and nothing is compiled in sloppy mode.
- **The TypeScript version follows tsrs's releases of stable TypeScript,** each
  upgrade gated by the four conformance suites (register L19).
- **A diagnostic registry, now** (register L21): every code with its meaning,
  whether it is permanent or "not yet", and its message. The missing early
  errors are completed in phase 3.
- **A container's narrow representation needs a proof, and arrays follow
  `Map` and `Set`** (later that day, not from the audit). A `Map<K, number>`
  that a wider alias filled with strings read those strings back as numbers in
  12 ways of reading a `Map` or `Set` (29 of 58 cases each), on every backend.
  The fix keeps a read value's run-time type unless the compiler proves that
  every writer stores the narrow type. Asked whether arrays should get the same
  design, accepting a `number[]` widened to `unknown[]` instead of refusing it
  (NTS1001, L5), the user answered "Yes on arrays, after the Map version lands
  and is measured".

## Builtins and globals (10-28)

From the open-questions audit; each is the register's recommendation.

- **nts's own implementation by default** (register G2); the host's only where
  a decision says so (Intl and RegExp on JS hosts, decision 3 of 10-22), each
  chosen by its benchmark row and conformance record.
- **Feature detection folds per target at compile time,** in both forms,
  `typeof X === "undefined"` and `"X" in globalThis` (register G3);
  `globalThis` itself stays deferred (L24).
- **`types: ["node"]` wherever a target's profile provides `node:*`** (register
  G4): native programs see node's types, timers included, and Chromium and
  browsers see the DOM's.
- **Chromium's overlay is injected by `target.chromium()`,** checked against
  lib.dom, and Blink's errors surface as `DOMException` (register G6).
- **The TypeScript JSON parser,** moving to `runtime/ecmascript`, serves an
  untyped `JSON.parse` until the compiler has its own untyped parser, and then
  becomes the test oracle (register G9).
- **All 28 `node:*` modules are owed on native,** with a `node:` resolver and
  the `process` and `Buffer` globals in the native profile (register G10).
- **A Node addon uses nts's own builtins,** one semantics; revisited if the
  size cost shows (register G11).
- **Builtins node lacks, such as `Temporal`, are provided wherever the host
  lacks them,** node included (register G15). Browser support, for Wasm, is
  still to be researched.
- **Randomness and crypto:** the OS's secure random generator on each target;
  `crypto.subtle` from the vendored OpenSSL on native, the JCA on the JVM, and
  the host on JS hosts (register G16).
- **`console` formats values as node's `util.inspect` does,** in shared
  TypeScript, written to each platform's log (register G18).
- **`SharedArrayBuffer` and `Atomics` on Android need API 33:** they are
  refused below it, and the Android floor stays API 29 (register G19).

## Memory, concurrency and interop (10-28)

From the open-questions audit; each is the register's recommendation unless
the entry says otherwise.

- **The bound on what a region or reuse may keep alive** is set from the memory
  census's numbers (register M-1).
- **Where the cycle collector's candidate index goes in the 16-byte header** is
  decided in memory stage 6, by measurement (register M-2).
- **A worker is the web `Worker` API first** (register C-1): a thread per
  worker, an isolated environment, structured clone and transfer, and literal
  hashes per thread. Node's `worker_threads` maps onto it later.
- **`SharedArrayBuffer` and `Atomics` rest on C11 atomics,** in memory stage 9
  (register C-2). `Atomics.wait` works on the main thread on native, as in
  node, and is refused in browsers and Chromium, as HTML has it. _Revises_ the
  register's recommendation, which refused it on the main thread, as browsers
  do.
- **One rule for threads nts does not own** (registers C-3, I-3): the runtime
  checks every entry from such a thread; callbacks are carried to the owner
  thread; a call that must return a value from another thread is refused
  (record 0018).
- **One async ordering contract for every backend,** enforced by shared
  ordering fixtures (register C-4).
- **Native `setTimeout` clamps its delay as node does,** browsers and Chromium
  as HTML does, and a two-arm fixture pins both (register C-6).
- **Every host error becomes a catchable `Error` carrying the host value**
  (register I-2); unwinding through C frames is researched first.
- **Promises cross boundaries** (register I-4): through N-API as a deferred
  plus a threadsafe function, and for C embedders through a documented
  `nts_checkpoint`.
- **ResourceFlow is built, with its enforcement** (register I-5), and the pages
  state that the memory model (M5) covers the language, not binding
  declarations.
- **Cycles through host objects are collected in memory stage 7** (register
  I-6), with Chromium's joint collection, and with an N-API family once record
  0356's references exist.
- **One nts instance per process,** for now, a second refused clearly
  (register I-7); the instance becomes a parameter with workers.
- **nts is a Node-API host,** a new decision rather than a register question:
  a program compiled for a native target (C, LLVM) can load a Node-API addon,
  a `.node` file, the way node, Bun and Deno do, so npm packages that ship
  native addons, such as `sharp`, run. The JVM and browsers load no native
  code. It is distinct from the Node addon target, in which nts builds addons
  that node loads. The user: "We should also implement N-API too (I do not
  mean generating NAPI like we currently do. I mean like nodejs, bun, hermes
  do, so we can run packages like sharp etc)!". What is still to design is
  register I-10.

## Products, toolchains and dependencies (10-28)

From the open-questions audit; each is the register's recommendation unless
the entry says otherwise.

- **`bind-c` binds whole headers,** with an overrides file, after ResourceFlow
  (register B-1).
- **The per-target intersection type check is implemented** (register B-2).
- **Platform surface packages are generated locally by default;** only the
  permissively licensed ones are published (GIR, the Win32 metadata), and
  Apple's stay local (register B-3).
- **Wasm products:** `target.web()` and `target.wasi()`, with ES-module and
  component products, after the Binaryen backend (register S-1).
- **Library surfaces:** objects cross the C ABI as opaque handles now;
  generated Swift, Kotlin and Java wrappers come later (register S-2).
- **npm distribution is prebuilt binaries per platform,** as esbuild and swc
  ship (register S-3).
- **A Chromium app is a separate app process with IPC,** as in Electron: the
  renderer program handles the DOM, and the app process holds system access
  (register S-4).
- **The compiler runs on Linux, then macOS on Apple silicon, then native
  Windows;** WSL works meanwhile (register T-3). Asked about the register's
  recommendation, Windows through WSL, the user answered "Shouldn't we support
  windows properly though?". _Revises_ that recommendation, and _supersedes_
  "nts itself never runs on Windows" ([Lanes](#lanes-09-23-09-24)). The
  bundled toolchain (register T-1) is to be put to the user separately.
- **A dependency policy, as a foundations page** (register D-1): exact against
  node, a permissive licence, a measured size, built from vendored source, and
  linked only when a program uses it. Platform SDKs are not "system packages".
- **ICU is bundled,** for exactness (D2, D3); revisited for mobile size
  (register D-3).
- **npm packages that ship only JavaScript:** their `.js` is compiled against
  their JSDoc and `.d.ts` types (record 0011) as the main path, plus hand
  ports of the top packages (register D-4).
- **No hardware is bought yet** (register A-1, the user's call on spending):
  Apple, Windows and arm64 builds stay unrun at landing. When the macOS host
  work begins, an Apple-silicon Mac mini is bought first; a Windows machine and
  an arm64 device come later.

## Performance and process (10-28)

From the open-questions audit; each is the register's recommendation.

- **Startup time, executable size and peak RSS become rows** now, against node
  and Bun, as memory stage 0 instruments (register P-2).
- **The noise rule** (register P-3): rounds of before, after and before again,
  over at least 5 processes; instruction counts decide regressions; wall time
  has a floor of max(3%, twice the spread); and where a row's layout range
  exceeds the effect, the mean over seeded code layouts decides.
- **Every comparator's version is pinned:** node, Bun, the JDK and clang
  (register P-4). Every report records the machine's load, and reference
  numbers are taken whenever the landing lock is free and the load is low.
- **Native instruction counts per benchmark row gate the full run,** against
  the noise band, starting with the counting drivers (register P-5).
- **The compile-time guard adds backend code generation and link time**
  (register P-6).
- **Analysis budgets scale with program size,** and every exhaustion is
  reported by name (register P-7).
- **A nightly full run, and a weekly one with result caches off** (register
  Q-3); `--touching` selects tests only after a test proves that it selects
  deterministically.
- **A per-case ratchet on conformance records** (register Q-4): each case may
  only move toward passing, and a record changes only through a reviewed
  `results:` commit.
- **The node pin moves with node's LTS releases,** together with the Unicode
  pin (D2); node's own tests gate once the node lane resumes (register Q-5).
- **A differential program fuzzer is built now,** as a phase 2 instrument
  (register Q-6).
- **Every full run includes a sanitized, reference-counted differential run
  over the whole corpus** (register Q-7).

## Debugging, security and versioning (10-28)

From the open-questions audit; each is the register's recommendation.

- **Line tables in every build** (register X-1): `#line` and line tables by
  default, frame pointers on if they measure cheap, and an unoptimized debug
  profile.
- **`Error.stack` is symbolized from the line tables on demand,** and an
  uncaught error is reported in node's format; the cost is measured first
  (register X-2).
- **Hashing is keyed and seeded, with a tree fallback,** adopted once its
  pending A/B shows the cost, and J2 on the JVM (register X-4).
- **The bounds rule is written into the specification** (register X-5): every
  index is proved in range or checked, and an out-of-range read gives
  `undefined` (L4).
- **The library ABI version is built now** (register X-7), and result caches
  key on the schema, compiler and runtime digests.
- **Vendored assertions stay in release builds** (register X-8) unless a
  benchmark row shows their cost; then it is decided per library.

## Gate and landing (10-27)

- **The fast landing model,** all three parts ("yes I agree with all those 3
  parts about the gate. lets do it this way!"):
  1. a change owes only the checks it can affect, and a change that owes only
     tree checks lands at once;
  2. the gate itself is made fast: its waiting fixed, results cached by their
     inputs, and only the cases a change can affect run;
  3. land, then verify: code lands after a short check, a verifier gates
     `main` behind it, and a red landing is reverted automatically. Changes to
     the gate itself stay strict.

  It replaces "land only through the gate" for code once its tools exist.

## Lanes (09-23, 09-24)

- **Apple (09-23, 09-24):** macOS and AppKit first, iOS later. A Swift-shaped
  surface replaced the NativeScript-shaped one (09-24). There is no Mac
  hardware and no hosted CI: a local quickemu VM.
- **Windows (09-24):** Win32 first, then WinRT and COM, then WinUI 3. The
  mingw ABI through zig now, MSVC later. A quickemu Windows 11 VM; nts itself
  never runs on Windows. _Superseded 10-28:_ the compiler is to run on native
  Windows, after Linux and macOS
  ([register T-3](#products-toolchains-and-dependencies-10-28)).
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

## Language (10-29)

- **A literal type is tested where an erased value enters it, and is never a
  proof.** Found when the parameter-arrival fix showed `claimed(value: 64)`
  returning 65 for every input, and a local array indexed by a `0 | 1 | 2 | 3`
  parameter skipping its bounds check under ASan. The user decided that an
  erased value (from `any`, `unknown`, JSON or foreign code) asserted to a
  literal type or an `enum` tests its value as well as its tag, as
  `JSON.parse(text) as T` already does: "yes, make erased values test the
  literal value". Asked about `number as 64`, the coordinator recommended no
  test, as in node: the value keeps its storage, method parameters admit such
  values without a cast, and the compiler takes values, ranges and bounds only
  from a proof over every arrival. Casts that change storage (a union member,
  a subclass) already test and throw. ScriptC draws the same line: it
  validates casts from run-time-typed values and between program classes, and
  documents no check for a cast between static types. Recorded in
  [types.md](../../language/types.md#decisions).

## Compiler (10-29)

- **C's number types are aliases where C's type is the same everywhere.**
  The user asked whether nts's scalars and C's types could be
  interchangeable, sketching one `Scalar<number, "label">` per kind, and
  agreed to the coordinator's recommendation:
  - a C type whose width and signedness are the same on every target nts
    builds for is an alias of the fixed-width kind (`c_int = Int32`,
    `c_short = Int16`, `c_longlong = BigInt64`, `c_double = Float64` and the
    rest), so the two mix in arrays, function types and overrides;
  - a C type that depends on the target (`char`, `long`, the pointer-wide
    integers, `wchar_t`) is a kind of its own;
  - each fixed width keeps an optional label of its own. TypeScript 7.0.2
    rejects a `Uint8` where a `Uint16` is written when the kinds share one
    label with a value per kind, and accepts it with separate labels;
  - a binding keeps the C type it was written with, for the witness and the
    emitted C.
  The missing names are built first. The page is
  [C headers](../../targets/c-headers.md#cs-number-types); the scalar table
  in `language/numbers.md` follows it.

- **Delegated decisions, late 10-29.** The user handed the coordinator the
  open questions of the evening: "take the best decisions you think we
  should make for all those issues you have mentioned". The coordinator
  decided:
  - the carried yield repair matches the JavaScript-era TypeScript's result
    for mixed valid and invalid yields if that compiler gives one, and is
    kept as it is otherwise; it goes when an official fix passes the
    controls;
  - the delegated `yield*` crash gets no patch; it goes into the upstream
    report, filed with microsoft/typescript-go as the root cause and then
    noted to tsrs, posted only after the user approves the exact text;
  - nts reports any internal panic, in the checker or the compiler, as one
    clear internal-error report with its phase, file and message and a
    distinct exit code, never continuing after it;
  - a solver's structural backstop asserts in debug and test builds even
    where an optional caller declines in release;
  - the super-linear lowering work (layouts and override tables rebuilt per
    function, the hierarchy cloned per entry, `in` scanning every type) is
    replaced by one shared context built once, after the memory-safety
    series and before the validation build's activation;
  - the licence guard's 36 s cost once a CC-BY input is declared is
    accepted, and narrowing it to projects that can reach an input is a
    follow-up;
  - if Babel cannot read caniuse-lite's data as a plain input without
    compiling its unpacking code, the Babel row stays blocked and recorded;
  - each worktree keeps only the cargo profiles its workflow builds
    (AGENTS.md), and `lane status` shows each tree's target size.

- **Every analysis converges or fails closed, compiler-wide.** Two silent
  wrong answers on `main` that day came from analyses that stopped at a
  round cap and handed on an unfinished optimistic result: `flow`'s fixpoint
  and `zero_sign`'s observed set, which lost a negative zero after a chain of
  72 steps. The coordinator asked the compiler lane to audit every capped
  loop in core. It found five more that do the same: legacy liveness and
  object-name closure, ownership freshness, the erased-only check before
  reference counting, class depth (which orders `instanceof` arms) and the
  suppliers of an inherited `this`. The rule `memory.md` already set for its
  analyses now holds for all of them (written into
  [architecture](../../architecture.md#decisions)). Each site becomes a
  worklist that converges, or a conservative answer on exhaustion, with a
  test at the old cap. The memory-safety sites go first.

- **Bounds checks are placed by one relational analysis.** The merge-bound
  fix put back checks that a wrong proof had removed. The user asked for
  smarter placement using TypeScript's static analysis, then left the design
  to the coordinator: "you decide about bounds check, no discussion needed
  anymore. its up to you." The decision, written into
  [objects.md](../../foundations/objects.md#arrays):
  - one analysis in `compiler/core` serves every backend. It tracks relations
    between values with constant offsets, learned from dominating branches,
    induction variables, allocations and, for a function no outside code can
    call, its call sites;
  - only an effect that can change a length ends a length fact, directly or
    through a call's whole-program effect summary. An element write ends
    none, and a call whose target is unknown ends them all;
  - loops it cannot clear are versioned, through the integral regions' loop
    versioning;
  - checks on one array merge;
  - the out-of-range path produces NaN where every use is numeric, and shares
    one branch with the program's own test for `undefined`;
  - every removed check is re-checked by name in the validation build;
  - it is bounded, from the compiler lane's review: a sparse worklist of
    difference constraints with a work budget, never an all-pairs closure, so
    a chain through many lengths cannot grow quadratically. A relation left
    unproved when the budget runs out keeps its check.

  Why: the census and the machine code
  ([notebook](bounds-check-placement.md)) show that a check left in the HIR
  costs a backend only where its own optimizer cannot finish the proof. clang
  removes `spectral-norm`'s `u[j]` check after inlining, while the LLVM
  backend keeps it in both inner loops. A proof made once in the core gives
  every backend the same result. Go's `prove` pass and LLVM's constraint
  elimination are the known designs.

  Order: the compiler lane builds it after the flow fixes have landed and the
  validation build's mode exists, and runtime2's loop versioning takes bounds
  as its second client.
- **LLVM is the frontier native backend, and C is held equally.** The user:
  "LLVM is the frontier native lane. C of-course equally." Both meet the bar
  on every row, and a row where LLVM is slower than C is a defect. In the
  10-29 comparator sitting the two are even on average (LLVM over C, geomean
  1.009 over 101 rows), but LLVM is more than 5% slower on 15 rows:
  `awfy-sieve` 1.31, `json-scan` 1.29, `upcast` 1.21, `awfy-permute` 1.14,
  `array-methods` 1.13. A likely general cause, found the same day: for
  `awfy-sieve`, nts's LLVM IR (before optimization) has no `nsw` or `nuw` on
  its integer arithmetic, no `inbounds` on its address computations, no
  function attributes or CPU, and no `!range`. It does carry 15 TBAA tags and
  6 `noalias`. The IR clang makes from nts's C (after `-O2`, so the counts are
  only a guide) has 54 `nsw`/`nuw`, 21 `inbounds`, 12 attribute groups with
  the CPU, 7 `!range` and 36 TBAA tags. The coordinator's guess that these
  missing facts cause the gap was measured the same day and refuted for the
  four worst rows. runtime added each fact to the IR by hand and counted
  instructions over a fixed amount of work (CPU 4, five repeats). No arm
  changed any count. LLVM over C in instructions is 0.992 for `awfy-sieve`,
  0.983 for `awfy-permute`, 1.000 for `array-methods` and 1.218 for
  `json-scan`, against 1.31, 1.14, 1.13 and 1.29 in wall time. So three rows
  run the same or fewer instructions more slowly, which the cycle counters
  and the layout-interval instrument are to explain, and only `json-scan`
  executes more. The LLVM IR is still to state what nts proves
  ([native](../../targets/native.md#two-backends-one-runtime)), as the design
  that lets it pass C, but not as the explanation of these rows.
- **Two LLVM-backend causes, found and decided for building** (10-29, the
  coordinator, on runtime's measurements at CPU 4 under the lock). The
  layout-interval instrument (20 layouts per arm, 99% bootstrap) shows the
  wall-time gaps are real: `awfy-sieve` +28.3%, `awfy-permute` +7.6%,
  `array-methods` +4.5%.
  - `awfy-sieve`: with the same instruction count, LLVM took 8.524M cycles
    and 98.2K branch misses against C's 6.995M and 27.9K. The misses sit on
    the data-dependent `flags[i - 1]` test. With `nsw`/`nuw` added by hand,
    LLVM took 6.584M cycles and 29.3K misses, 5.9% under C, because the
    no-overflow fact changes the loop's shape. The compiler lane's soundness
    review licenses only `nsw`, from the same exactness map
    (`core::exact`) that lets C use signed arithmetic, so the shipped
    change carries `nsw` alone, confirmed by a sitting of its own.
  - `json-scan`: link-time optimization internalized `scanNumber` on the
    C path and specialized it to the program's one JSON text, while the
    LLVM path kept it public and generic. Marked `internal` by hand, LLVM
    ran 10.431M instructions against C's 10.651M and its own 12.972M. The
    coordinator first attributed the difference to `dso_local`. runtime
    measured that alone and refuted it: with `dso_local` and identical
    linker resolutions, the LLVM path still kept the function external.

  Both are built: `nsw` from the exactness map, and a product-aware
  linkage rule decided by the coordinator on the compiler and runtime
  lanes' proposal. In an executable, a definition is external only if
  something outside resolves it by name: entry points, names the product
  publishes, names a loader or by-name registry looks up, and symbols
  native code links against. Everything else, including a module's exports
  the product does not publish (`scanNumber` is exported but not public
  API), is `internal` in LLVM and `static` in C, from one shared decision.
  Generic and shared outputs keep their external ABI. No hidden visibility,
  and nothing left to link-time internalization. The first wording also
  made external every function whose address goes to native code. The
  Objective-C snapshots caught that: the compiler lane showed that
  `Counter__bump` and `Held__state` are reached through static shims whose
  addresses are registered, so a pointer-only callback is kept but stays
  private.

## Contributors and packages (10-29)

- **CC-BY-4.0 data may be a benchmark's input.** The Babel workload of the
  Web Tooling Benchmark needs caniuse-lite, which is CC-BY-4.0 and outside
  the permissive list. The user allowed it as a benchmark input only:
  attributed, kept under `benchmarks/`, and never linked into nts or into a
  program nts builds. Recorded in
  [cloud-agents](../../contributing/cloud-agents.md).
- **The worker-budget patch is removed; tsrs stays as upstream wrote it.**
  The patch gave the vendored checker one thread limit, set once by nts, so
  that compile work measured the same on any CPU mask. The coordinator
  approved it on 10-28 without checking the 10-24 rule, which allows one
  temporary patch, for the two checker crashes only. The user approved
  offering it to oxc-project/tsrs, with the pull request itself approved by
  the user before it opens, but upstream's contribution guide keeps pull
  requests closed, so nothing was sent. Asked for an alternative that leaves
  tsrs unchanged, the coordinator found upstream already has what
  measurement needs:
  - the checker count and a single-threaded mode, both of which nts already
    sets;
  - `RAYON_NUM_THREADS` for the parsing threads, which tsrs's own benchmarks
    set to 1 when they count instructions.
  The user decided to remove the patch. Measured compiles run
  single-threaded, with that variable fixed by the gate's environment, and
  the compile-time record refuses a measurement taken otherwise. nts's
  `--workers` option goes, or becomes what upstream lets nts control. The
  crash patch's read-only hook for two tests is the remaining addition
  outside the rule, and the user keeps it for now.

## Plan (10-29): the Bun and ScriptC studies

- **The studies are audited, not adopted wholesale.** Two cloud agents studied
  Bun's ahead-of-time compiler (oven-sh/bun #45631) and ScriptC; the user
  asked for an audit, experiments where an idea's value is unknown, and the
  outcome in the plan. The coordinator held new optimization starts, not the
  whole team, during the audit: correctness, infrastructure and web work went
  on. The merged table is [the audit](aot-studies-audit.md); the decisions
  are in [plan.md](../../plan.md#from-the-bun-and-scriptc-studies).
- **Comparators:** the user replaced Bun's JIT with the two ahead-of-time
  compilers: "add scriptc and bun with AOT this time instead of plain bun".
  ScriptC runs with its automatic Node islands off, so every column compares
  native code. The coordinator noted that Bun's author reports AOT losing to
  its JIT in places, so the JIT may be the stronger rival on some rows.
- **The validation build checks numbers inductively** (10-29, the
  coordinator, on the compiler lane's prototype). Three ways to check
  narrowed numbers were measured by hand on emitted C under the production
  flags: re-checking the removed bounds checks only; a full double shadow of
  every number; and the inductive oracle, which checks each narrowed value
  where it is defined against the original double operation recomputed from
  operands already checked. Instructions per normal build, on the arrays,
  elementwise and sieve workloads:
  - bounds only: 5.1, 10.0 and 1.0 times;
  - full shadow: 17.2, 94.1 and 11.4 times;
  - inductive: 5.2, 52.8 and 3.3 times.

  The inductive oracle checks every narrowed number at a fraction of the
  shadow's cost, and every sabotage control (a bypassed entry, corrupted
  `i32`, `i64` and phi values, a lost bit above 2^53, an `INT64_MIN - 1`
  overflow) traps by its name. The prototype also caught the merge-bound bug
  on main by its trap, where ASan read allocator padding without complaint.
  Its corpus cost is not yet known; it decides the mode's place in the
  nightly run ([plan](../../plan.md#from-the-bun-and-scriptc-studies)).

## Calling C (10-30)

The user, the coordinator, four research reports and the measurements in
[record 0361](../0361-calling-c-from-a-header.md) settled how TypeScript
calls C. The specification is [Calling C](../../targets/calling-c.md).

- **No generated layer that needs metadata.** A first proposal generated a
  "plain layer" from a per-library file of facts. The user: "I think I do not
  like the plain layer. It needs extra metadata." Refined APIs come instead
  from TypeScript packages written over a binding, and from Node-API addons
  once nts loads them (I-10).
- **The binding is the C API as the header declares it,** written with
  TypeScript's values: "when binding a C library from a header, the
  developer would expect the same API like it is in C, but write it with
  JS/TS semantics." `bind-c` binds whole headers per target, with no file of
  facts. This replaces the overrides file of B-1.
- **The rules,** accepted by the user ("I accept your recommendations"):
  - struct classes over C memory at a fixed address, `new T({...})`
    zero-filling, read-only nested fields, copies by `Object.assign` and
    copy constructors; `local<T>()` removed;
  - `Ref<T>` for out-parameters, since TypeScript's checker cannot see C
    write to a variable (measured with TypeScript 7.0.2);
  - `addrOf` on fields and elements, only as a direct argument;
  - typed arrays and `CArray<T>` as C memory, plain arrays only where C just
    reads, and pointer fields that keep their targets alive;
  - a `string` for `const char *` for the call, an interior zero as a
    `TypeError`, results as pointers read with `stringFrom`, and `cstring`
    for strings C keeps;
  - handles opaque and nullable, released by the program;
  - return codes as values, `errno()` saved as each call returns, and C
    adapters for `longjmp` libraries;
  - callbacks as functions that capture nothing, data through the context
    pointer or a `Handle`, and an escaping throw as the program's uncaught
    error;
  - every pointer and handle nullable unless the header says non-null, and a
    NULL non-null result as a `TypeError`;
  - enums open unless declared closed, C shims for function-like macros and
    `static inline` functions, and variadic calls typed per call with
    `format` checked;
  - a checking build that runs tests under AddressSanitizer and poisons what
    each call was lent.
- **ResourceFlow (I-5) and the fact tags.** ResourceFlow keeps checking the
  ownership facts a platform's metadata states (GObject, Objective-C, COM,
  Windows). For plain C, a header states no ownership, so its work is the
  checks above. The fact tags (`@ntsNoEscape`, `@ntsFree`, the closure kinds,
  `Counted` and the rest) stay only where metadata generates them.
- **`node:ffi`.** The user: "we should also support it at some point, because
  we are gonna update our nodejs version." nts implements `node:ffi`,
  compiling literal definitions to direct C calls, and generates a
  `node:ffi` implementation of each binding so that C-interop programs are
  compared with node. The node reference moves from Node 24 to Node 26, the
  latest LTS line.
- **The plan.** The user: "I think it should placed directly into our plan
  and be built in parallel." It is phase 2, item 9 of
  [the plan](../../plan.md), with owners for each stage.
- **The audit's fixes.** The user had asked for "one last audit" and accepted
  the coordinator's recommendations. The audit
  ([report](c-interop-research/audit.md)) found four rules that let ordinary
  TypeScript reach freed memory, and the coordinator took its fixes into
  [Calling C](../../targets/calling-c.md): a value lent to C lives to its
  block's end; a buffer once lent cannot be detached; nested references hold
  their root, with `CArray` indexes checked; handles are checked integer
  tokens. With them: a C call ends what the program knew about memory C can
  reach; stored pointers are held by their object; the generated types are
  stated; plain-C callbacks run only on the owner thread inside a C call, and
  TypeScript signal and exit handlers and `setjmp` are refused; struct
  classes are branded, with their fields as own properties and `copy` as C's
  struct assignment; header attributes such as `counted_by` are read;
  variadic arguments carry a C kind; `CFunction`, `unsafeCast` and pointer
  constants; `errno()` and `lastError()` are saved only where read. The
  coordinator departed from the audit in three places
  ([record 0361](../0361-calling-c-from-a-header.md#the-audit)). Five decided
  pages changed with it: native.md (stored pointers are held), errors.md (a
  throw escaping a C callback ends the process on every target), gtk.md and
  windows.md (a zero inside a string throws) and memory.md (a lent value's
  lifetime).
- **`node:ffi` later.** The user, after the decision: "we will tackle node:ffi
  at some point later. no need to integrate it now. we just have to keep it in
  mind." It leaves the plan's stages, and the design keeps room for it
  ([Calling C](../../targets/calling-c.md#later-nodeffi)).
- **Node 26 later.** The user: "No need to interact with Node 26 yet though.
  Why do it? node ffi later, update to node 26 later." The node reference
  stays on Node 24; the move waits with `node:ffi`, and the work started for
  it is kept, unlanded.

## Contributors and language (10-30)

- **A handoff may assign a cloud agent any path.** The user: "yes chatgpt
  agents can work to whatever we need to". The paths a handoff names are that
  task's exception to the default out-of-scope list. The first such task is
  the program generator, in `tooling/census/generate/`
  ([cloud-agents](../../contributing/cloud-agents.md#decisions)).
- **Tests are written naturally, never around a compiler gap.** The user:
  "we should avoid adding eval and new Function etc... but normal typescript
  that we are supposed to eventually support, should be written as it should
  be, with no hacks or compromises because we have a compiler gap. the
  compiler gap should be noted, and when it is the right time, we support
  it".
  - The coordinator had asked the proofs suite's author to steer around
    three shapes nts refuses today: a `const` reading a module-scope loop's
    variable, some `bind` and `apply` forms, and a per-iteration `let` that
    closures capture. All three requests were withdrawn.
  - The module-scope loop gap went to the compiler's queue, with the
    suite's refused cases as its guards.
- **Reflection may yet be supported.** The user: "Reflection MIGHT eventually
  be supported though. We will do an investigation when we have our compiler
  bulletproof." The investigation covers what the boundaries page refuses
  today, the prototype chain's reflection and the redirect hooks, beside the
  set already in scope for later. `eval`, and `Function` given run-time
  source text, stay a permanent boundary
  ([boundaries](../../language/boundaries.md#decisions)).
- **WHATWG text in source code is BSD-3-Clause; MDN's prose is CC-BY-SA.**
  - WHATWG's standards state: "To the extent portions of it are incorporated
    into source code, such portions in the source code are licensed under the
    BSD 3-Clause License instead."
  - MDN's documentation is CC-BY-SA 2.5 or later, which the permitted list
    leaves out.
  - So the JetStream TypeScript-library port (#118) stays blocked, since it
    embeds TypeScript's DOM library, MDN-derived comments included, in its
    program's source.
  - nts's own binary embeds the same library files through the vendored
    checker, so their MDN attribution is owed in the top-level `NOTICE`
    before nts is distributed.

## Node 26 (10-31)

- **The move.** The user: "nodejs 26.13.0 is no[w] the LTS version. I think
  it is time to 'migrate' to it." This ends the 10-30 deferral
  ([Calling C](#calling-c-10-30)); `node:ffi` stays for later.
- **The approach.** The user: "I think we should just mechanically 'update'
  third_party deps and .tool-versions node version and do no check. I think
  there is no point to gate or benchmark anything yet. I think there is
  higher value to see how we are gonna update/migrate/enhance our
  runtime/node code. The procedure and the 'migration' would be interesting.
  Then we [can] only run the nodejs test suite."
  - The node lane resumes for it, on one branch
    ([plan](../../plan.md#now)). A mechanical commit moves the pin, node's
    sources, and the bundled libraries' recipe and licence records.
  - `runtime/node` then moves module by module, each against node's own
    changes between the two versions. Node 26's tests on both lanes check
    it.
  - `zlib` is the pilot that settles the procedure, and the procedure is
    reported to the user before the other modules follow.
  - The branch lands once, through one gate, and the benchmarks run after.
  - Each tree links the node inputs its own `.tool-versions` names, from
    directories keyed by version, so trees on both versions coexist during
    the move.

## JVM class archive (10-31)

- **The decision.** The user approved shipping a JVM program with a class
  archive, on the coordinator's recommendation. `nts build` writes the archive
  from the classes it emitted, without running the program. The program uses
  it on the Java that built it and runs the same without it on any other.
- **Why.** A runnable jar's first call pays to load and parse its classes. In
  a probe on the four case-conversion rows, an archive cut nts's first-call
  CPU time 5–6× on every row. That was enough to beat Java's own first call on
  the `œ`, Greek and CJK rows; ASCII, Latin-1 and unchanged text still lost.
- **How it lands.** As its own change with startup rows, after D4's
  corrections; helper2 builds it and runtime3 reviews it as the JVM's owner.
  The design note first settles three things:
  - how the archive reaches the JVM, since a runnable jar's manifest cannot
    name JVM options;
  - what a different Java does with it, verified rather than assumed;
  - whether the archive is reproducible byte for byte.

## Native export names (10-31)

- **The decision.** An export's derived C spelling is the published contract:
  literal and never escaped, with the existing keyword suffix (`bool_`) as the
  only change. Any public spelling in nts's reserved `__nts_` namespace is
  refused with NTS2007, whether or not it collides with a generated name
  today. Private names that only look reserved get a reversible escape that
  never reaches a header. The coordinator decided this under the user's
  delegation; runtime3 built it, and it landed in 4dcd0a422.
- **Documented.** The user approved the page line on 10-31, apart from the
  C-interop docs still being worked out.

## Language (11-01)

- **A type predicate or an assertion function over an erased value asserts
  as `as` does.** Found when compiler4, building the per-type property plan
  for the guarded-Record memory hole, asked what sixteen soundness cases
  should give. In each, a lying `value is { value: number }` or
  `asserts value is ...` narrows an `unknown` holding `{ value: "7" }`, and
  the case expects node's string. The coordinator decided under the user's
  10-27 choice ("Catchable TypeError", register L6) that `x is T` and
  `asserts x is T` are TypeScript's other two ways to claim a type for an
  erased value without proof. The same lie throws the same `TypeError`
  however it is spelled. Keeping node's string would leave every value read
  through such a guard erased, the representation cost that decision chose
  not to pay. The check sits at the first field or element read that needs
  the narrowed representation, never at the predicate call. A false
  predicate over a typed value (an `A | B` narrowed to `B`) behaves as node
  does. Recorded in [types.md](../../language/types.md#decisions).

## Typed-array subclasses (11-01)

- **The decision.** A class extending a typed array is its own class with the
  view's representation. The coordinator decided it under the user's
  delegation, on ClaudeHelper's design note:
  - its own descriptor, the runtime view's in everything but name and
    methods, and a descriptor kind for views, which `instanceof Uint8Array`,
    `ArrayBuffer.isView` and native hand-off read;
  - `instanceof Bytes` takes the ordinary class path, no longer folded to
    `false`;
  - the view is made with its class where `super(...)` makes it: in C through
    a creation helper that takes the descriptor, and on the JVM as a
    generated class extending the element's view class, since a Java object
    cannot change its class;
  - species through a slot every view descriptor has. A chain with no
    declared constructor makes the same view with the receiver's descriptor.
    A declared constructor is called as JavaScript calls it, with
    `(buffer, byteOffset, length)` from `subarray` and `(length)` from
    `slice`, through construction by identity. The call is direct wherever
    the closed world proves the receiver's class, so a plain `Uint8Array`
    costs nothing; only an open receiver loads the slot. A
    `static [Symbol.species]` that names a known class makes it, and any
    other species getter is refused by name;
  - names: `[object Uint8Array]` from the element type, and `Bytes` from
    `constructor.name` and inspect, with a guard per printer.
- **Species through a declared constructor,** ruled on ClaudeHelper's
  question while building it. Each class with a declared constructor in its
  chain gets two species entries, synthesized calls of its constructor copy
  keyed on the class. They are reached through synthetic call sites in the
  copy planner, so a union parameter gets its member copy. Where the declared
  parameters do not accept the species arguments (`constructor(length:
  number)` reached by `subarray`'s buffer), the target is still node's
  answer, since a false type claim on a typed value behaves as node does. It
  is the same problem as a bivariant method argument, and it lifts with the
  representation taken from proved arrivals. Until then that `subarray` or
  `slice` call is refused by name, with a refusal fixture and an accepting
  control.
- **Why.** `new Bytes(4) instanceof Bytes` was folded to `false`, and
  `subarray` and `slice` lost the class: silent wrong answers, recorded in the
  builtin-identity family. The class had no descriptor, so the test had
  nothing to compare.
- **Cost.** A program without typed-array subclasses changes only a view test,
  from one pointer compare to a kind load, on erased paths. The typed-array
  benchmark rows are measured as an A/B against main.
- **How it lands.** Construction by identity (#144) makes the subclass's
  constructor run. ClaudeHelper builds the rest on it: the failing fixtures
  first, then the runtime kind, descriptors and creation, species, the JVM
  classes, and the records last.

## Team and priorities (11-01)

- **Foundations and correctness in parallel.** The ChatGPT families
  recorded 264 silent wrong answers in the TypeScript suite on C, and under
  "silent wrong answers first" both compiler agents had moved to them, so
  the memory analysis, bounds-check placement, regions and the builtins
  mechanism's stage 3 stood still for four days. The user: "we should work
  parallely on correctness and foundations. the tests that the chatgpt
  agents bring are nice yes, but I started chatgpts so we can leverage them
  to write 'boilerplate' tests lets say. not try to pass every test. this
  is like running test262. We should focus more on getting the foundations
  close to our planned result/performance! Of course there will be bugs and
  we should fix them." So the foundations are the main line; bugs are fixed
  beside them, a silent wrong answer before a refusal and both by how much
  real code they affect; and the families' failures are recorded, as
  test262's are, without setting the order of work.
- **compiler3 returns to the foundations track** once its module-scope loop
  fix (#164) lands (memory stage 2, then bounds-check placement, then
  memory stage 3) and stays there. compiler4 and ClaudeHelper fix bugs;
  compiler4 takes the typed containers' remaining wrong answers (#158) after
  #159, since they are the foundation's own.
- **Stage 3 of the builtins mechanism** has had no owner since runtime2
  left. It goes to the runtime agent once its compile-time fix (#168) lands.

## JVM class archive (11-02)

- **The decision.** The user approved, on the coordinator's recommendation,
  an archive that belongs to its installation, revising the 10-31 entry,
  which expected one archive shipped with the program. An explicit build or
  install step writes a classic CDS archive at the jar's final absolute path,
  from the emitted classes and without running the program. The jar stays the
  reproducible, portable product. The archive repeats byte for byte at the
  same path and differs between installation roots. A launcher supplies it
  only when the selected Java's `release` file matches the one recorded when
  it was written, and otherwise runs the plain `java -jar` route. A moved or
  changed jar falls back the same way until the archive is written again.
  With it, a program the build proves can start no threads of its own (no
  Java interop, no host provider that starts threads) returns from `main`
  after its work drains with status zero, instead of calling `System.exit`.
  Every other program keeps the exit path.
- **Why.** helper2's design note measured the alternatives on 409dd, on eight
  CLI-built jars under Corretto 21 and OpenJDK 27. The installed archive won
  on every row. A first-run cache costs about 330 ms on its first launch, 8–12
  times a warm start, which a one-shot program never earns back. JDK 27's AOT
  cache regressed four rows and was neither relocatable nor byte-reproducible.
  A relative-path classic archive reproduces across roots but fails from
  another working directory. With the clean return, startup falls to
  0.71–0.82 of today's on all eight rows. The remaining gap to plain Java is
  2–4 ms of entry reflection and initialization.
- **How it lands.** helper2 builds it as its own change with startup rows,
  runtime3 reviews it as the JVM's owner, and the launcher is qualified on
  each platform it ships for. The design note goes into `docs/records/` with
  the change.

## JVM generated names (11-03)

- **The decision.** On the coordinator's review, generated JVM members use
  `¢nts$`, a namespace outside TypeScript identifier syntax and outside the
  mangler's image for authored names. Authored `nts$` members remain valid. One
  closed member catalogue generates the compiler, runtime and tooling
  bindings; freshness and exclusivity checks prevent a second naming producer.
- **Identity and spelling.** Available source identity is encoded readably and
  injectively, rather than replaced by encounter-order ordinals. Property-key
  domains remain separate, dispatch retains its hierarchy-owned relation, and
  static values retain their producer-owned declaration. Anonymous identities
  are explicit. The catalogue covers members only. Generated classes retain a
  separate authority for declarations and instantiations and one publisher,
  which reuses a request from the same owner and rejects a different owner
  under the same name
  before generation.
- **Why.** Compiler protocols must not override an authored member or hide an
  inherited Java facade. Readable source identities also keep stack traces and
  verifier records useful when unrelated declarations are inserted. Observers
  consume structured method identities and compiler-owned raising relations,
  so a rename cannot silently disable their checks. The contract is in
  [JVM and Android](../../targets/jvm.md#decisions).

## Lanes hold for the new workflow (11-03)

- **The decision.** After the usage limit stopped every Codex lane on the
  morning of 11-03, the user resumed them: each lane finishes its current
  job to landing, at the same bar and without hurry, and then holds. New
  work goes through the new project workflow instead of long-lived agents.
- **Who is still working.** compiler4 (#159), nodejs (#193, then Node 26),
  tsrs2 (the gate tooling) and the Codex chromium agent. The others hold.

## Chromium performance bar (11-05)

- **The decision.** The user set the Chromium lane's bar: compiled TypeScript
  calling Blink is as fast as Blink's own C++ calling it directly. The
  `blink-intrinsic` lane of `tooling/chromium/benchmark.ts` is the target on
  every kernel and every shape, entries included. V8's page script stays as a
  reference column.
- **Why.** The lane exists to remove the JavaScript layer between a program
  and Blink, so the cost left to remove is everything the compiled side pays
  beyond Blink's own calls. Beating V8 is not enough: on 11-05 the compiled
  canvas call already beat V8 at one entry per call (0.94 times), while its
  entry still cost about 61 ns more than Blink's own C++. The contract is in
  [Chromium](../../targets/chromium.md#decisions).

## Language boundaries (11-05)

- **The decision.** The user: "I think we should only skip support for eval,
  new Function and with (I might forget something that is really unsafe like
  with and super dynamic like eval). for the rest, we have to find the best
  representation/performant solution when it is time to." Two permanent
  boundaries remain:
  - code made from text while the program runs: `eval`, direct or indirect,
    the `Function` family's constructors given source text, and a timer given
    a string of code;
  - sloppy mode, which includes `with`. `Symbol.unscopables` acts only inside
    `with`, so it goes with it.
- **Everything else is in scope.** The prototype chain's reflection and
  replacement, realms, `Symbol.toPrimitive` and `Symbol.hasInstance` join
  `globalThis`, `Proxy`, `Reflect`, object integrity and the descriptors. Each
  is built after the static foundations, with the best representation the
  compiler can prove, and costs nothing where a program does not use it.
- **What it replaces.** The test262 boundary list of 09-29, and the 10-30
  "reflection may yet be supported", which this answers with yes.
- **test262.** Only the two boundaries leave the denominator. The exclusion
  files are narrowed to them as planned work. The contract is in
  [Boundaries](../../language/boundaries.md#decisions).
- **A third boundary, the same evening.** The user: "this should not be
  supported: changing an object's prototype at run time." So
  `Object.setPrototypeOf`, `Reflect.setPrototypeOf` and assigning `__proto__`
  are refused permanently. Reading a prototype and choosing one when an object
  is made (`Object.getPrototypeOf`, `Object.create` given a prototype,
  `__proto__` in an object literal) stay in scope.

## Tests-only landings (11-05)

- **The decision.** The user: "Why do we need the gate for those test
  fixtures. I guess we should revise our rule for the gate? Just land them!
  They are just test fixtures." A change that only adds or edits test
  fixtures lands without a gate run, like documentation.
- **Why the records still come with it.** A fixture's record is the gate's
  verdict on it, and a fixture without one turns the next train red for
  someone else. So the coordinator records new fixtures with the gate's own
  recorders on main's official pin, twice and identical, and checks that only
  new rows appear. The contract is in `AGENTS.md`.
- **Failing tests land too.** The user, the same evening: "of course they
  should be included in our main. it is normal for tests to fail. they are
  tests." A test is never held out because nts cannot build it. The record
  gains a build-failure outcome (#228), so the failure is pinned the way a
  wrong answer is, and the four existing hold-out commits are reverted once
  it lands.
- **First use.** The thirteen ChatGPT families of PRs #391 to #454, 3,118
  files: 3,110 tonight, and the 8 that nts cannot build yet once #228 lands.
- **The gate's tooling.** The same evening the user asked for a survey of
  mature build and test tools, such as Bazel, Buck2, Nx, Turborepo, tup and
  BuildXL, before more bespoke work. The file-access recorder (#245) is held
  at a WIP checkpoint until the survey's verdict.

## TypeScript oracle ownership and public emit (11-04)

- **The decision.** The pinned public TypeScript API creates the configured
  checking program with noEmit semantics and emits its source-resolved program
  through `ORACLE_EMIT_OPTIONS`. Complete files, import edges, raw input byte
  hashes and diagnostics are checked before publication. The producer's
  sourceFileName relation owns outputs; source maps only present coordinates.
- **Owner imports.** Imported ordinary sources keep their nearest project,
  including nested owners. Full configured checking context stays intact while
  only the requested closure is published in a source-layout mirror. Reference
  overlays change output locations only. An emission-only TS2877 is accepted
  only through its exact checker relation and its target owner's executable;
  both consumers validate that relation and all raw diagnostics remain bound.
- **Reuse.** Owner emission is shared only within a registered run and replays
  every recorded observation on reuse, including failed lookups and directory
  reads. Changed inputs require re-emission. Binding injection uses published
  source identity and the captured namespace's present, absent or unknown
  answer.
- **Scope.** Authored JavaScript CommonJS runs as plain Node outside the capture
  claim and is reported separately. Transitions into TypeScript, ESM or
  providers require captured ownership; unproved governed requests hold before
  Node resolves them. General CommonJS replay belongs below Node.
- **Execution ownership.** Fresh execution owners retain read descriptors from
  before launch; loaders retain validated append descriptors. Exact child
  delegation carries the validated environment and paired reservation/ready
  records, so caught bootstrap failures hold their owner. Descriptors close on
  every path, and drained results belong to one execution.
- **Why.** One program authority preserves source checking and resolution, while
  explicit captured ownership prevents omitted inputs from becoming ordinary
  missing files. The specification is in
  [TypeScript](../../conformance/typescript.md#decisions).

## TypeScript emitter authority, runtime target and run seal (11-04)

- **The decision.** TypeScript's own emit, run by Node, defines the oracle's
  answer where native type stripping differs. Our negative-zero enum case
  follows the emitter's folding to positive zero. One ES2026 emit target serves
  Node 24 and 26, with the owner's module and class-field defaults carried and
  its original library inputs preserved.
- **Why.** Neither supported Node parses the emitted ESNext decorators. The
  pinned compiler rejects RegExp modifiers at ES2024 with TS18062, while the
  permanent syntax controls run the ES2026 output on both Nodes. The public
  compiler's own programs pin every accepted target's effective defaults.
- **Run ownership.** A canonical parent validates the dependency image once and
  hands consumers a version-specific ready-record seal. Each acquisition
  checks that inode and its exact stat identity; metadata hashes and actual-use
  bytes, links, kinds and query domains remain checked. A changed seal is a
  named instrument hold, not evidence against a landing. Outside a run,
  acquisitions keep full validation. The specification is in
  [TypeScript](../../conformance/typescript.md#decisions).

## Oracle snapshots and Node resolution (11-05)

- **The decision.** A preparation validates all original observations before
  publication and again after its consumers drain, before any measured row or
  cleanup. A final difference holds the entire session. Children authenticate
  the compact index and the exact bytes they load, without replaying originals.
- **Resolution.** One dedicated process per Node version and run batches public
  hook queries without evaluating targets. Children replay authenticated answers
  only with the same effective options and executable identity; a live holder
  pins the binary and its process birth. Unrecorded requests retain the bounded
  live path and its complete domain proof.
- **Maps and startup.** Map options come from the owner; the oracle adds none.
  Generated type-free runtime assets live only in run scratch and are checked
  before evaluation. Parent-only capture code stays out of children.
- **Worker ownership.** A closed, captured driver gets private context through
  workerData. Reservations record begin and ready; a parent closes a failed
  launch only before begin. Incomplete bootstrap and invalid handoffs are named
  instrument holds even when test code catches the error.
- **Why.** Repeating complete proofs in each process makes work depend on the
  snapshot's size. The parent establishes one snapshot for the run; children pay
  for the authenticated paths and bytes they use. The specification is in
  [TypeScript](../../conformance/typescript.md#decisions).

## Fresh start (11-06)

- **The decision.** The user approved the workflow in
  [`docs/workflow.md`](../../workflow.md) and a fresh start of the machine:
  "for sure remove every branch/worktree that is not needed", keeping the
  Chromium build caches. On archiving the rest: "by archiving it, we for sure
  will forget it." On the Codex archive: "I think we should just ditch them."
- **What replaced archiving.** No new `refs/archive/` refs. Unfinished work
  stays on a branch only while a task in [`plan.md`](../../plan.md) names it;
  everything else is deleted. Two reviews read every branch the old rules
  would have archived: the retired lanes' resume notes, and every finished
  commit since 10-20 that no task cited. Their still-wanted work became
  tasks with branches.
- **Citations stay resolvable.** A commit that a record or result on `main`
  cites by hash, and that `main` does not contain, gets `refs/cited/<sha>`, a
  pointer at that commit alone (272 on the day), so deleting branches never
  breaks a citation.
- **The Codex archive is gone.** Its 140 refs dated from 10-03 to 10-12;
  `main` had moved 2,850 commits since, one fix had been taken from it in a
  month, and a bug it fixed that still exists shows up as a failing case.
  The quarry rule left `CLAUDE.md` and
  [the workflow page](../../workflow.md), which replaced the old one.

## The switch (11-07)

- **Records follow landing** (user, 11-06: "shouldn't tests and benchmarks
  land directly?"). Every record check lists a case with no row as pending
  and does not fail it; `tooling/records/record-pending.ts` writes the rows
  after landing. The ratchet ranks a silent wrong answer below a loud defect,
  so a wrong answer that becomes an abort passes as an improvement; a case
  refused before and after, for other reasons, is accepted, because lifting
  one refusal exposes the next on every compiler improvement. Any other
  change within a rank still fails.
- **The landing check is its own tool**, `tooling/landing/`, not a mode of the
  old lander: one change at a time against the newest `main`, so trains,
  halving, attribution and holds had nothing left to do. It reuses the step
  runner, the path rules and the canonical environment. The old lander and
  the lane machinery were removed with the switch.
- **Counting is the full check's own hourly step**, not a gate step: inside a
  landing, the machine's state would turn a good change red, and inside the
  core it would start a culprit search with no culprit.
- **A test that starts a real gate runner owns its memory reading and its
  unit.** On 11-07 a stacked train went red on a tooling test whose inner run
  read the host's memory inside a full gate and waited silently past the
  tooling runner's watchdog, and a runner orphaned by a proof spun a core in
  the tmux pane's own cgroup, where no unit could stop it.
- **A gate step may not wait forever.** On 11-07 the `dex` step compiled one
  benchmark port for 4.6 hours at full CPU, and the queue waited with it.
  Every step and every per-case compile gets a time bound, and a timeout is
  a recorded outcome.


## TypeScript case transform and shared answer (11-07)

The single-file TypeScript case suite uses the pinned public `transpileModule`
API. Node judges the resulting JavaScript; nts performs the case's type checking
and compilation. A checking Program adds work that the reference execution does
not need. The syntax-only path also covers the corpus's const enums and internal
namespace aliases, with permanent controls following those constructs.

The run measures one answer per case and shares it across the backend steps.
Preparation stays inside admitted worker lifetimes, and each executable snapshot
is finalized and released before the worker takes its next case. Original input
facts and the authenticated result remain run-owned. Reuse validates every
recorded observation, including failed lookups and directory listings. The
captured-JavaScript loader retains its unknown-domain holds.

Named populations are selected before sampling. Omitted recorded cases are not
missing, selected unrecorded cases remain pending, and selected recorded cases
still pass through their ordinary comparison. The full check's writer measures
pending cases. General project graphs retain their owner-program checking and
emission contract.

## Baselines for the gaps Node 26 exposed (11-08)

Four wide steps were red after the Node 26 runtime: definitions in five
modules, zlib's compile time on both providers, and the refusal profile. Each
loss is pinned by a refusal fixture with a control and a plan task. The user
accepted today's numbers as the new baselines: the five definitions floors at
their counts, zlib's compile-time baseline re-recorded (five repeats, the 1.10
tripwire kept) and the profile ceiling at 1,929 (1,889 plus the usual 40).
These floors are kept by hand, so the task that restores the functions raises
them back.

## The old workflow's history stays (11-08)

Asked how far the cleanup of old-workflow references should go, the user chose
"leave history, move notebooks": instructions, the workflow's tools and data
notes say only the current way of working; provenance written in the old
lanes' words ("Found by the JVM lane") stays as written; dated notebook pages
outside `docs/` move to `docs/records/notebooks/`.

## The full check sweeps (11-08)

The user approved the full check removing, each hour, two kinds of leftover
its count reports, and nothing else. The count had only reported: on 11-08 it
named 52 red lines, which the user removed with a reviewed script, and by the
evening runs stopped since had left 38 more folders, and the full check's own
records runs had left two pins of commits no longer `main` or `verified`.

What it removes: a folder a stopped run left in a scratch root of `keep.json`
past that root's age, when nothing inside it changed since (a run may still
be writing it otherwise); and a pin whose provenance says the full check
built it, for a commit that is neither `main` nor `verified`, a day old and
named by no task in `docs/plan.md`. A link is never followed and nothing
outside `~/.cache` is touched. What stays report-only: folders no rule keeps,
pins anyone else built (a peer's evidence), the node test roots, branches and
worktrees.

## Hand-run gate logs are swept (11-09)

The user approved a third kind for the full check's hourly sweep: the logs of
gates run by hand (`~/.cache/nts-gate/runs`, from `all.sh` and `pinned.sh`)
once they are past three days. The landing and full checks prune their own
runs; a gate run by hand has no service to prune it, so its logs stayed until
someone removed them, and the count was red each time one passed three days
(the first on 11-09, a run of 11-06).

A run's folder goes when it is past three days and nothing inside it changed
for those three days, so a run still writing is never removed; `latest`, the
link to the newest run, is never followed. Everything else the count reports
stays report-only.

## The full check stops empty, unbound nts slices (11-10)

A fourth kind for the hourly sweep, from #633, whose card the user took: an
empty nts slice bound to no active unit is stopped by name
(`systemctl --user stop <slice>`, never by PID). A census's slices bound to
nothing, so a census killed without closing left them loaded for ever — 44
top-level census slices on 11-10, 255 empty unbound nts slices when the
count first read them.

With it: a run's slices bind to the unit their process runs in (a census's
aggregate, each worker to its aggregate), as a gate step's do, so a stopped
unit takes its slices with it. Only a slice active longer than the count's
own hour is stopped: a run on older code (a pin, the full check's verified
tree) still creates its slice unbound, and it is empty for a moment before
its first scope starts. A younger one is a note in the count, kept until a
later count can prove it old. Everything else the count reports stays
report-only.

## Records are evidence, never instructions (11-09)

The user asked whether `docs/records/` helps or harms an agent: 457 files and
143,000 lines, of which 58 records are linked from code, tests and pages, and
339 of the 363 numbered records are linked from nothing. Much of it describes
tools, workflows and designs that have changed since, and a search for a name
returned as many hits there as in the live tree (a search for `tsgo`: 49 files
in the records, 105 elsewhere).

Decided: the records stay as the evidence store; AGENTS.md says they are
history, read when something links them, with the page holding where the two
disagree; and a repository `.ignore` keeps search tools out of them unless the
path is named. The 339 unlinked records stay where they are for now.

## Tasks are GitHub issues (11-09)

The user decided that tasks move from `docs/plan.md` into GitHub issues, with
the local board for chores, and that the plan shrinks to the priorities and
the order of the streams. The plan had grown to 764 lines holding tasks, their
state and their order together, which a coordinator had to reread and edit by
hand as work moved.

Decided with it:
- one issue per task, a sub-issue of its stream's parent issue;
- every issue made by `tooling/tasks/new.ts` against one spec: the labels in
  `.github/labels.json` (`task`, exactly one `area:`, exactly one `kind:`, at
  most one `state:`) and the card's sections;
- GitHub's default labels deleted, so its labels are the file's;
- a task's branch is `<N>` or `<N>-<slug>` (`tooling/tasks/branch.ts`), and the
  hourly count names it while issue N is open;
- no periodic check reads the open issues' content: the user ruled it out as
  too much.

131 issues were made from the plan on 11-09 (#467 to #597), after a check
against `main` that dropped two finished tasks and rewrote nine.

## A landing closes its issue, and a revert reopens it (11-09)

The user approved that a task's issue follows its change: the landing service
closes the issue when the task lands, and the full check reopens it, with a
comment, when it reverts the task's commit.

As built (#597):
- a change from issue N's branch that names the issue neither as closed (a
  GitHub closing keyword) nor as `Part of #N` lands with `Fixes #N` added to
  its last commit, ahead of its trailers; GitHub closes the issue when `main`
  reaches the commit;
- a slice that leaves its task open says `Part of #N`, so a task landed in
  several slices closes with its last;
- the full check reads the issues a culprit's message names and comments on
  each (the red steps, their logs, the culprit search and the revert), then
  reopens it; a culprit that names none, or an issue `gh` cannot reach,
  leaves a task line in the full check's status instead.

## Records and the count run beside the parts (11-09)

The user asked (#611) that the core keep running on every new `main` while a
records run records: on 11-09 the records run for be64f8805's 127 pending rows
began at 18:14 UTC and held the controller's cycle for over 70 minutes, while
main gained five commits no core run checked; and the count, which the cycle
ran only when nothing else was due, last ran ten hours before.

As built:
- background work runs in a systemd user unit of its own, named for its kind
  (`tooling/full-check/background.ts`): the controller writes the unit's name
  and its outcome's file into its state before the unit starts, and a
  controller that restarts finds it by that name, waiting while it runs,
  reading the outcome once it ends, and starting it once more, then giving
  it up as a task, when it ended without one; the nightly benchmarks are to
  use the same units (#604);
- a part's records run records in `nts-full-check-records-<part>`, in a
  records tree of that part's (`~/.cache/nts-full-check/records/<part>`, its
  cargo target its own), on that tree's own code at the run's commit, with the
  run's pin made before the next core run builds over it; the controller
  applies the delta on the newest main in the same tree once the unit ends,
  and stays the only writer of its state, of main and of the queue; a tree
  per part, so the core's records and the wide steps' never wait for each
  other;
- the count runs from its own hourly timer (`nts-full-check-count.timer`,
  `service.ts --count`), writes its own file, which the status's `count`
  reads in the same shape, and keeps the pin a records unit records with out
  of its sweep; it holds the controller's tree's lock shared while it reads
  that tree, and the controller moves the tree to `verified` only while
  nobody holds it.

## The nightly benchmarks run in a unit and land on the newest main (11-09)

The user asked (#604) that the nightly measurement survive a controller
restart and that its results land: on 11-08 and 11-09 the nightly attempts
kept nothing, a hang and then a restart of the controller, which ran nts-bench
as its own child for the two to three hours a run of 165 cases takes; and a
results commit built on `verified` was refused once main's `full.md` renderer
or results had moved, with nobody reading the answer.

As built:
- the run measures in `nts-full-check-bench` (background.ts), in a bench tree
  of its own at `verified`, on that tree's own code, so `with-lock.sh`, a
  shell script read as it runs, is never the controller's, whose tree moves
  to `verified` under a running unit; the session's memory is reserved first
  (`admit.ts --key bench-session`, at full-check priority, by the gate
  target's scheduling history, where earlier sessions' peaks are), then the
  measurement lock admits it;
- nts-bench is built by the gate's build step at `verified`, as before, and
  copied into the run's folder, since the next core run builds over the
  gate's target while it measures;
- a restarted controller adopts the unit by name; a unit gone without an
  outcome is started once more, then the night is a task; an eight-hour hang
  guard stops a unit that never finishes, which is then not measured;
- the run's record is published on the newest main by main's own
  `run-record.ts publish`, in the bench tree, and that results-only commit is
  followed by the loop that follows records (`followLanding`): published
  again after a refusal, a held one at once, three attempts in all, then a
  task; one night's run is in flight at a time, and a nightly slot that comes
  while a run measures waits for it.

## One memory ledger for the machine (11-09)

The user asked for one memory admission pool for the machine ("fix it", #590),
after the full check's core was held three times on 11-09 by a nested
oracle preparation that waited for host memory its own gate run was using.

As built:
- `tooling/gate/memory-ledger.ts` keeps one queue for every heavy job: the
  landing check, then agents' work, then the full check, first come first
  served within a priority. A request is admitted when the memory free beside
  what admitted jobs may still take covers it, with 2 GiB kept for the system.
- A gate run holds one reservation, measured by its own cgroup, that grows in
  1 GiB blocks as its steps and tokens need it and shrinks as they end; a run
  outranked by a waiting request of higher priority starts nothing new and
  gives back what it does not use, so the request waits only for running work.
- Tools inside a step run inside its reservation; standalone, a job reserves
  once (`reserveJob`), and `node tooling/gate/admit.ts --bytes <N> -- <command>`
  runs any command through the ledger. The 12/14 GB host waits are gone.
- Each step's memory peak is recorded, for sizing the reservations from
  measurement rather than the step table's declared numbers.

## Reservations are measured peaks (11-09)

The coordinator decided, on #590, that what a step or job reserves in the
memory ledger comes from what it was measured to hold, not from numbers the
step table declared: in the core run at be64f8805 most steps held a small
part of their row (jvm 0.2 GiB of 8) and some held more than it (tooling 5.3
GiB of 0.5).

As built:
- the gate's scheduling history (`<target>/gate-costs/steps.json`, version
  3) keeps, beside each step's CPU seconds, the charged peaks of its last
  five runs per unit (the step, or one token of an elastic step), and the
  peaks of jobs that reserve outside a step (`reserveJob`, `admit.ts --key`)
  per worker; every canonical gate run and every job writes it, and it is per
  target, so a landing tree learns its own builds;
- a unit reserves 1.25 times the largest kept peak, at least 128 MiB; a key
  never measured in its history reserves the largest of its kind there, and
  with none its share of the machine (MemTotal times its width over the
  slots);
- the runner samples each step's slice every 250 ms on the ledger's basis;
  a step that held more than it was counted for is `over` in its summary row
  and in the ledger's status, which also names the keys sized unmeasured;
- a step's census aggregate runs under twice its reservation, never below its
  share or one census worker's own cap, so a case replayed alone meets only
  its own limit in a fresh tree as in a warm one; a cap that grows with its
  grant while the step runs is #609;
- the step table's `mem`, the hand calibration (memory-calibration.ts and
  results/gate-memory-calibration.json) and its warning are gone;
- the nightly benchmark reserves its session at the full check's priority
  before the measurement lock admits it, so a wait in the ledger never holds
  the lock.

## Reservations yield to a request that outranks them (11-09)

The coordinator decided, on #615, that a reservation of lower priority yields
to a waiting request that outranks it whatever code holds it, and that a
landing's build hands its reservation to its gate run. In the landing of
#590's slice 3a on 11-09 the build waited 394 s behind agents' fixed
`admit.ts --bytes 12G` jobs, which only gate runs' code had made yield, and
the gate run's growth 413 s behind one admitted in the four seconds between
the build's reservation ending and the run's first request.

As built:
- the decision on a request counts each admitted reservation of lower
  priority as its use and a margin (what a measured unit reserves for that
  use, never more than it reserved), not all it has not used; nothing is
  rewritten or stopped, and its whole promise counts again once nothing
  outranks it. The ledger stays accounting only: such a job can grow back to
  its whole reservation after the request was admitted on the smaller
  figure, which a kernel cap equal to its grant bounds (#609);
- a request can take over a reservation whose measure counts its memory
  (`replaces`): the decision that admits it ends that one under the ledger's
  lock. The landing check reserves its build's memory in its own process and
  hands it to its gate run (NTS_MEMORY_HANDOVER), which takes it over with its
  first request and hands it to nothing it starts;
- the ledger's status counts as the decision on the queue's head does.

## The full check writes the test262 records (11-09)

test262's records were written at 7e18d0845b23 (the built-ins slice at
35be2d8d04f5) and had fallen 173 compiler or runtime commits behind (#599).
Their population is the cases that already ran, so nothing but a full run by
hand found a new pass, and the floors in tooling/gate/all.sh were raised by
hand. The coordinator approved the design with three conditions. As built:
- census steps (test262-census-c, -llvm and -jvm, in the wide part) run each
  directory whole against its record and list each case that runs now (a
  pending line naming the record: pass, or fail with what it threw) and each
  recorded fail that passes (an improved line); a regressed, changed or
  missing recorded case still fails them;
- record-pending.ts's test262 kind records after the wide part, and its
  pending cases are the ones the census listed; the writer measures exactly
  those cases three more times from scratch on the run's pin, writes a row
  only where every repeat agrees, and writes nothing from a degraded machine;
- a new fail row is pending and recorded, never silently: the full check
  names every one in a task line, by record and directory, with the full list
  beside the run (test262-new-fails.tsv), because a case gone from refused to
  failing may be a soundness loss;
- the floors left all.sh because every record was at least as strong at
  8ff9de50edee: language 6,982 passes against a floor of 6,935, built-ins 887
  against 824, annexB 9, staging 53 and harness 17 against floors of the same;
  accepted negatives 1,315 against a ceiling of 1,353, and 185, 1, 3 and 0
  against ceilings of the same. No test262 floor had been lowered for a pinned
  gap: 11-08's baselines were the definitions, zlib and the profile;
- placed by measured cost, on a pin of bcfa40808012: the five directories run
  whole cost 2,827 CPU s on C (8 min 55 s at 8 workers), 2,482 on LLVM and
  1,985 on the JVM (about 9.5 and 8 minutes at 8 slots), so the three run in
  the wide part. On main they listed 34, 35 and 34 cases that pass now and 2,
  6 and 2 that fail now, and nothing regressed, changed or went missing.

## A reservation made inside another job's draws on it first (11-10)

The coordinator decided, on #621, that a request made from inside another
job's reservation draws on that one's unused part first and asks the ledger
only for the rest. #615's yield had ended the deadlock across priorities, but
at one priority the same shape still waited for ever: an agent's admit.ts
holder whose gate run (run.mjs holds a reservation of its own) needed more
than the room left beside the holder, while the holder ended only when its
run did.

As built:
- a request draws on the reservation it names (`drawsOn`: a gate run names
  the one it was started inside, which may be its own process's, as when
  admit.ts became its shell), else on its nearest ancestor process's, as when
  a launcher's canonical environment dropped the name (inner.ts, check.ts
  --here); one the other covers whole asks the queue nothing and waits behind
  nobody;
- while it holds what it drew, that is lent: the other promises that much
  less, and its measure leaves out what the drawing reservation measures
  itself; a growth draws as its reservation did, and a shrink gives back the
  drawer's own part first;
- what a gate run's own process reserves before its steps (the oracle
  dependency capture) runs inside the reservation the run was started inside;
- a takeover (`replaces`) never draws on what it takes over;
- the ledger's status shows each drawing reservation beneath the one it draws
  on, with its share of it.

## A step's grant is its slice's limit, and grows while it runs (11-10)

The coordinator decided, on #609, that each gate step's slice is held to the
memory the ledger granted it, with the grant grown while the step runs, so the
ledger promises only what the kernel enforces. Step slices had no limit of
their own: only a census aggregate was capped, at twice its reservation, so
several steps growing past their reservations together could squeeze work
already admitted, and an outranked run could grow back past what a landing
had been admitted beside (#615's caveat).

As built:
- a running step's grant -- a fixed step its reservation, an elastic step one
  token's share per token it holds, each with what it grew by -- is its
  slice's MemoryHigh, where the kernel throttles and reclaims and nothing
  dies (an elastic step holding no token is allowed one token's share for
  its idle workers, uncounted); MemoryMax is a hard bound above it, a block or a quarter of
  the grant, with no swap, for a runaway; the run counts each step at its
  grant, and a throttled burst briefly past it is bounded by that margin;
- every 250 ms the runner grows a step whose charge nears its grant, or
  passed it, by what it is over by and a quarter of its grant, at least 64
  MiB, from the reservation's slack or a growth of it, and both limits rise
  together; the
  charge leaves out page cache, so the kernel reclaiming a step's cache at its
  grant never grows it;
- a step killed at its own hard bound, one stopped holding more than the
  ledger could ever give, and one still throttled for a growth not given by
  its bound are memory pressure (held, retried), never FAIL;
- a census inside a step has no aggregate cap of its own: it verifies the
  step slice's, and a case killed there is pressure, requeued;
- a gate run's reservation is capped, and the ledger promises a capped one
  all it has not used instead of #615's use and a margin; jobs that are not
  capped keep that yield (#627 caps them);
- only a waiting request that could fit were every admitted job to end makes
  a job yield.

## Memory limits guard against runaways only (11-10)

The user decided, on #635, to keep the memory ledger (admission, priorities,
measured-peak reservations, the yield, nested draws) and the per-case caps
that define memory-cap verdicts, and to stop holding steps and jobs to their
grants with kernel limits. #627's probe found that anonymous memory past
MemoryHigh with no swap does not slow but stops (94% stalled on memory,
stuck for five minutes), so a stalled process's wall clock runs on and can
fabricate a timeout; and the journal showed no machine-wide OOM kill on 11-09
or 11-10, most of it under an accounting-only ledger. #627 (capped jobs) was
closed as superseded.

As built:
- a step's slice has MemoryMax alone, at twice what the step was measured to
  hold (its grant over the reservation's 1.25), never below its grant and a
  block or a quarter of it more, and never past what the ledger could give
  the run; no MemoryHigh, swap 0;
- the runner still grows a step's grant from its sampled charge, for the
  ledger's accounting, and the bound follows the grant; nothing waits for a
  growth;
- a step killed at its bound is memory pressure, held as an INSTRUMENT;
- gate runs' reservations are no longer capped: #615's use-and-margin yield
  holds for every job again, and #609's rule that only a waiter that could
  fit makes a job yield stays;
- the OOM score adjustment ranks work by priority: the landing check's unit
  100 (a user unit asking 0 is given the user manager's own 100), agents'
  work 300 (admit.ts and agent-priority gate runs raise themselves, since an
  agent's shell sits at 0), the full check 500.

## The compiler is made fast, not cached (11-10)

The user decided that the compiler's speed comes from the compiler itself,
and that caching its work is the last resort. The compiler already kept none
of its own work between runs: the frontend's semantic snapshot cache had been
deleted after it kept a missing sibling module missing once the file
appeared.

As recorded:
- no cache of the compiler's own work (snapshots, HIR, results) between runs;
  memoization inside one compile stays, since it is work done once;
- caches of another tool's work stay, each keyed on every byte the tool
  reads: `build.cache`'s clang objects, and the compiled runtime objects the
  differential checks and the test262 census reuse (in one `nts check`,
  clang took 2.03 s of 2.06);
- the full check's planned result caches, and the weekly run with them off,
  are dropped: it never reuses a verdict;
- open question L22 no longer plans a validated cache.

## Streams, groups and tasks (11-10)

The user approved the whole-project issue organization and its maintenance:

- The plan's streams are `kind:parent` issues. Each foundation or coherent
  theme is a `kind:group` under its stream, with its governing design and
  acceptance rows or executable contract tests. One independently landable
  change is a task under a group, for one agent, small enough to land within
  a day.
- `task` marks a ready leaf only. Unscoped and held or parked work stays
  open without it; groups are never assigned to agents. Labels retain one
  area, one kind and at most one state. A landed task closes itself and
  leaves an unfinished group open.
- Close wanted work only when it is on main, its remaining scope is retained
  in a duplicate's destination, or an adopted decision supersedes it. Name
  the evidence. Age is never a reason to close it.
- The creation tool checks the shared cards and actual parent roles in both
  its CLI and batch forms. The read-only hierarchy audit runs at coordinator
  checkpoints, never as a timer or a network dependency of the compiler's
  gate. This keeps the no-periodic-issue-audit decision; the machine count's
  existing minimum open-number lookup is unchanged.
- Benchmark row lists are owned by their design pages and shared by group
  selection and reporting. A new row is planned until its instrument exists;
  no results or oracle counts are invented before landing.

This replaces the direct stream-to-task hierarchy in the 11-09 task decision.
Priorities, native-first ordering, phase holds and the measuring decision are
unchanged: instruction counts decide regressions, and wall time counts only
past max(3%, twice the spread).

## Step budgets exclude idle admission waits (11-10)

The wide test262 census used most of its stated hour waiting for memory or
higher-priority work, and its wall timer stopped it before its records were
checked. An elastic step now spends its execution budget while a case holds
a token or its script works. With no active case, only a known gate-owned
memory, priority, slot or frontend wait suspends that budget. Token
transitions account for short cases between polls; a script without a
request and an eligible but unanswered request still spend the budget.

Every case supervisor retains its own clocks. Fixed steps retain their wall
bounds, and a landing's ceiling independently bounds wall time including
waits. Step summaries and logs separate execution and admission waits; the
census streams progress and reports its worker count and directory time.

## Worker supervisors outside case pressure (11-11)

A retained accounting root holds sibling supervisor and worker subtrees. Each
subtree has the step's dynamic runaway bound. The worker subtree's cap excludes
the supervisor, which survives to record the kernel's result. Each case scope
sets OOMPolicy=kill and verifies memory.oom.group=1 before executing work, so a
native command and its child processes form one OOM victim group.

Census pools, oracle preparation and execution, and compiler case workers share
MemoryRun's scope entry. Plain active commands and instruction counters use the
same resource boundary. Resource setup surrounds perf, preserving counts from
the measured command's exec. Activity observation lives in a separate leaf
module, so prebounded compiler invocations can reuse it without another scope.
Tooling-test workers enter the retained worker subtree while their collector
remains outside its cap. The accounting root still owns memory sampling,
priority, dynamic grant updates, drain proof and cancellation.

The old shared cap killed a pressure worker and then its supervisor before the
victim's anonymous pages had drained. A higher victim score cannot protect a
supervisor that remains in that OOM domain. The kernel hierarchy now excludes it.

## Full-check wall backstop (11-11)

The full check's measured command has a controller-owned wall ceiling, including
when it runs a historical runner. It is three times the last canonical green
run's measured wall with a fifteen-minute floor. Where that evidence is absent,
the longest requested step's measured wall supplies the baseline. The command
and its detached tooling units share an owned slice. Expiry stops that slice and
writes a named hold that overrides any premature summary. Known admission waits
continue to leave a tokened step's execution allowance intact.

A priority recheck reached the scheduler before oracle setup completed, released
the run's reservation against its empty startup queue, and allowed setup to
resume into workers whose tokens could no longer obtain memory. Scheduling now
starts after setup and token initialization. Loss of a live run's reservation
stops and names its unfinished work.


## Tests own their view of the host (11-11)

The resource contract lives in [workflow](../../workflow.md#the-machine) and
AGENTS.md. #695 introduces one complete HostObservations capability for each
fixture, propagated through gateEnvironment to dependencies, child processes
and peak samplers. It supplies disk space and inodes, memory, paging, resident
charge, machine width, load and a monotonic clock. Missing observations fail by
name instead of selecting the live host. Production uses the live adapter;
pure decisions receive observations, while kernel wiring controls explicitly
select live sampling and wait on readiness in their own units.

The priority-admission control's synthetic memory did not cover oracle startup's
real disk admission. It waited below the disk floor before reaching its fake
execution clock. The inventory and landing-run evidence are attached to #694;
#695 is the resource capability slice of that group.

#696 makes command liveness a pure state machine over output, CPU counters,
busy/sleep state and monotonic time. active-process.ts retains process-group
and pipe ownership behind one complete observation capability; fixture holes
never select a live reader. Group birth identity remains a kernel safety
check. The integrity control that failed under load now replays observations;
real children prove only sampling and exit wiring behind named barriers.
The [supervision inventory](../tooling-host-tests-696.tsv) maps all 127 rows
to supplied decisions, readiness controls or existing broad wiring guards.
The benchmark session's former 500 ms race also receives a supplied budget
event after child readiness; its real unit stop and retained prefix remain
observed.

#697 owns test children's environments through an allowlist. HOME, XDG,
temporary and Git state belong to each TestContext and are reused by its
children. Node, JDK and rustup directories are resolved ahead of shims that
consult HOME: the asdf Java shim exited 126 under a private HOME, while the
declared JDK binary succeeded. Run, oracle and resource handoffs are named,
and independent resource fixtures revoke reservations in both the environment
and its canonical context.

Isolation does not imply cold caches. An early per-child environment produced
42 private native archive caches and a 473 s, 2,469 CPU-s tooling step, against
#695's 234 s and 1,865 CPU-s. Content-addressed caches are declared by name,
separately from private mutable state, so native dependencies, pinned Node inputs, C objects, case
roots and JVM CDS retain their shared inputs. #702 separately owns making the
native archive's identity and bytes independent of extraction paths.

#697 also makes fixture cache lookup strict: a missing declared cache fails by
name before a production account-home resolver can run. The fixture marker
travels with the cache bundle; nested fixtures inherit only its declared
entries. Node compile cache resolution is lazy, so importing an owner cannot
read the account's cache behind a fixture's private HOME.

### Test host ownership is checked across dependencies (11-11)

The test-host gate step audits tooling source, generated children, shell
launches and Rust host-fixture constructors. Machine reads belong to named
adapter modules. Existing reads outside them are recorded by module and kind
and may only decrease; fixture environment copying is always forbidden. Test
workers own complete resource observations. Their setup sends poisoned launcher
inputs through the environment allowlist before installing resource/cache grants;
mutable child state remains private to each fixture. The source inventory is
in `docs/records/tooling-host-tests-698.tsv`.

## Landing verdict reuse (11-11)

The user decided that the full check's core takes the landing service's
green step verdicts for the exact commit it checked under the same canonical
environment contract, then executes the remaining obligations. A commit
without matching evidence receives the complete core. This supersedes the
earlier prohibition on result reuse. The governing contract is in
[workflow](../../workflow.md#after-landing-the-full-check).

The receipt preserves the checked tip, actual outcomes and coverage,
environment identity, producing profile, binary identities and record notices
before main advances. Combined core results retain provenance and distinguish
executed CPU from the cost of imported outcomes. The wide part still executes
its plan on verified, and culprit search consumes the combined observations
for each actual commit. Failing-step confirmations execute independently.

The coordinator accepted the existing `nts-dev` workspace test verdict for the
core's development-profile test obligation because both retain overflow checks
and debug assertions. This equivalence expires when every test route uses one
named profile. Release artifacts remain tied to the measured commit.

Comparing the live services' environment reports found launcher-dependent PATH
entries and ordering. The coordinator directed #701 to construct the canonical
PATH from the shared toolchain-directory resolver and fixed system directories.
The receipt contract keeps strict PATH equality. Explicit fixture tool inputs
remain owned by their fixture's source.

## One strict project for all tooling (11-12)

The tooling gate checks one project containing every tooling `.ts` and `.mjs`
module, with strict flags, `allowJs` and `checkJs`. It validates both flags and
file coverage. The root fixture base's inherited default glob had nominally
covered tooling without any gate route checking that project. The base now
excludes its own tooling subtree; parser controls also prove child fixtures
keep discovering their sources. A tool-written per-module diagnostic record
may only fall, so cleanup can proceed by directory while every new module is
checked at once. Diagnostics in imported compiler and runtime sources remain
with their own projects. Governs [the machine](../../workflow.md#the-machine);
implemented by #711 under #710.

## Admitted work keeps its rank and place (11-12)

The nested reservation replay found two stalls: a full-check borrower yielded
at its own rank while its agent ancestor's unused promise blocked the outside
agent, and same-rank growth waited behind a later new job that could not fit.
The latter was already netted correctly against ancestor bytes; the earlier
claim of missing netting was wrong. Top-level growth also took a new ticket,
and empty queues let multiple admitted jobs receive the same sequence.

An admitted job now grows at its admission place before later arrivals of
**equal rank**, and a borrower follows its live admitted ancestor chain for
both rank and order. Higher-rank landings still preempt admitted agent jobs;
only those jobs' own lifetimes delay later equal-rank work. Fresh independent
requests retain FIFO. One owner feeds admission, yield, status and handoffs.
The ledger allocates unique order across live admitted and waiting entries.
The coordinator chose finishing admitted work over surrendering its forecast
mid-run to begin a later job. Governs [the machine](../../workflow.md#the-machine);
implemented by #718, with both captured configurations and the top-level growth
control replayed through fixture-owned observations.

## Wide runs follow verified during idle time (11-12)

The user replaced fixed daytime wide slots with a trigger on verified
advancement, while retaining the nightly run before benchmarks (#716).
The coordinator chose a four-hour minimum between actual wide starts and
an idle start condition: no queued/running landing and no live
higher-priority memory request. A proposed two-hour gap allowed roughly
three times the observed daily CPU cost, so it was rejected. The nightly
attempt can cross the gap and repeat an unchanged commit. Its idle wait
ends two hours after the nightly slot; it then enters ordinary full-check
admission, preserving the ledger's priorities. Daytime starts retain the
idle condition. Eligible changes coalesce; a blocked opportunity does not
consume a start. Background records and benchmark units keep their existing
lifecycle. The governing contract is in
[workflow](../../workflow.md#after-landing-the-full-check).

## Step CPU is versioned cgroup accounting (11-12)

A same-run #720 control spent at least half a CPU second in a descendant, then
killed it without reaping. GNU time counted 0.10 CPU-s; the retained step cgroup
counted 0.660816 CPU-s. The earlier #711 typecheck also reported only 0.17 CPU-s
through rusage while its standalone unit counted 3.754 CPU-s in a separate run.

Final step CPU comes from cpu.stat after the cgroup is empty and before it is
removed, through the complete HostObservations capability. Fixtures supply
counters; kernel wiring controls select live CPU explicitly. Missing counters
fail the instrument, without a fallback. cgroup-v2-scope-v1 is authoritative;
wait4-rusage-v1 remains an explicitly versioned comparison. Version 4 scheduling
history keeps memory peaks and drops legacy CPU; baseline and landing-cost
readers accept CPU only from the matching measure. Receipts preserve their
basis, imported work has zero executed CPU in both comparisons, and combined
summaries partition mixed-basis totals. Separate build preparation retains its
named rusage basis. Governs [the machine](../../workflow.md#the-machine).

## Declared readers place gate inputs (11-12)

The #722 fixture's `${configDir}/tooling/**/*` string discharged an unknown
tool's full-gate obligation. #723 separates placement from inferred reach:
canonical step inputs, collected tests, parsed imports and named module-relative
URL assets place files; quoted-text inference can only add checks. Dot-only
URL positions are anchors. Directory assets place tracked members and the
census reports each reader and breadth. Traced areas with no gate runner have
settled rules naming their standalone readers. Untraced paths keep the full
fallback, held by a tool-written inventory that can only fall.
Canonical step directories declare data membership without parsing corpus
programs as host modules. Parsed references and indexes live for one selector
invocation only; a new run reads fresh source and configuration bytes.

The whole-tree investigation found that a fixture's runtime wildcard and the
migration destination table had been claiming unrelated trees. Removing all
module-text inference would also remove real reader edges, so that conversion
is separate work (#728). #723 retains its additive reach. A new exact reader
may retire an old fallback; shared selector, toolchain and supervision policy
keeps full reach explicitly. Governs
[landing selection](../../workflow.md#landing-the-landing-check).

## Bounded entry precedes execution inactivity (11-12)

The benchmark build tests installed a real 200 ms inactivity window around
systemd startup. A controlled 600 ms launcher delay reproduced the pre-entry
failure three times on unchanged main, although entry writes readiness before
exec. The generic failure then discarded the supervisor's reason.

CommandLiveness now consumes bounded readiness as an observation. Its startup
phase has a separate wedged-launcher bound, and execution inactivity starts
only at entry. Startup exhaustion is tooling-setup, NOT MEASURED, and a failed
launcher retains its actual diagnostic. Both plain bounded commands and
standalone compiler scopes use the same phases. Build decision fixtures replay
fixed counters and clocks through the shared model. Kernel wiring controls
explicitly select live observations and release a launcher barrier after it
has outlasted its execution idle window. Governs [the machine](../../workflow.md#the-machine).

## Sampler services stop by message (11-12)

#735 reduced a Node 26.13.0 Worker termination abort to builtins only: 16/16
processes aborted with an async dependency, while the synchronous control
had zero aborts. The sampler now starts and stops by message, while the parent
records its peak and releases memory synchronously. A separate closed promise
certifies reply and exit, including natural reservation completion. Scoped
owners await it before tearing down reporter-owned state. Termination is only
a named bounded fallback. A
source rule rejects top-level await in Worker entry closures. Governs
[the machine](../../workflow.md#the-machine); the
[reduction](worker-termination-2026-11-12.md) is retained outside sweeps.


## CLI memory peaks survive command-unit shutdown (11-12)

The detached CLI watcher samples outside the command service under the run's
tooling slice. At owner exit it moves its own PID to a fresh collected scope,
whose one-minute RuntimeMaxUSec bounds only the history flush. A sampling
scope that cannot start refuses before command execution; every history write
failure is named. See [the reproduction](exit-peak-2026-11-12.md) and
[the contract](../../workflow.md#decisions).

## Child records publish atomically (11-12)

A generated producer uses `durableRecord`, rather than exposing a file while
its bytes are still being written. The test-host audit parses source at script
and eval sinks and at explicitly branded source factories. Its one sealed
oracle exception is verified as a unique temporary followed by rename. A record
pipe was rejected because an inheriting grandchild can hold it open after the
subject exits. See [the contract](../../workflow.md#the-machine).
## Infrastructure probes have one owner (11-12)

Short spawnSync questions to git, systemctl and tool versions use one
synchronous owner and a five-minute wedged-tool guard. Timeout, signal or
launch errors name their purpose and fail the instrument before a fallback or
case classification. Fixtures inject runner results. A shared Worker bridge
was rejected as unnecessary machinery for these synchronous questions; their
existing APIs and product-specific case bounds remain intact. See
[the contract](../../workflow.md#the-machine).
## Pooled cases own memory admission (11-12)

The benches A* LLVM compile and dex flight-planner emit-jvm were killed by
forecast-derived step worker limits below their own case caps. Both were
reported as system pressure, although the kernel named an ancestor cgroup.

One runner-owned case lease now uses stable step, backend and source-path
history. Known cases ask for their measured peaks; unknown cases are charged
live use and the ledger margin. The token pool admits their sum inside the
run reservation and requests growth for a case larger than the initial grant.
A separate worker-boundary registration raises the enclosing worker subtree
before execution without enlarging any real enclosing case cap. The lease
keeps its token through final peak capture and worker drain. Local ancestor
OOM counters identify the firing cgroup and both limits. JavaScript pools,
resident feeds and shell pools share this owner. Governs
[the machine](../../workflow.md#the-machine).

## Unknown reach is separate from full policy (11-12)

The input inventory had combined unplaced fallback paths with explicit full
policies. Moving the shared token scheduler from JavaScript to TypeScript
therefore failed the path-set ratchet even though its reviewed full policy
moved with it and its declared readers remained present.

The census now lists the two populations separately. Only unplaced fallback
paths are ratcheted, and replacing one with another still fails. Full-by-policy
paths retain each governing rule name; the rules in owed.mjs govern their
reach, and editing that selector owes the full gate. The tool-owned writer
migrates the mixed record to the split format. This refines
[declared reader placement](#declared-readers-place-gate-inputs-11-12) and governs
[landing selection](../../workflow.md#landing-the-landing-check).

## Future state versions are read-only (11-12)

#725 follows a mixed-version scheduling-history replay: a v4 writer retained
memory peaks, then a stale v3 publication reset the file it could not read.
Every versioned shared state owner now recognizes future headers before schema
validation and rechecks under its publication/deletion lock. Histories decline
to record, operational state refuses, and future receipts run the requested
checks. Synchronous ledger cleanup leaves a named warning and an entry for
dead-owner reclamation when its lock cannot be acquired. See
[the inventory](../future-state-2026-11-12.tsv) and
[the replay](future-state-2026-11-12.md). Governs
[the machine](../../workflow.md#the-machine).
## Fixture tooling follows declared closures (11-12)

#743 replaces fixture dependency lists and one-level import discovery with
`copyModuleClosure`, then applies private mutations. The source audit follows
raw copy/write inputs through parsed bindings, including shared helpers.
Whole-namespace mirrors are exempt only at their discovered namespace; standalone
entry exceptions expire when an import or asset is added. Closure staging exposed
undeclared Node launch drivers, now declared at their readers for #728. The oracle
recipe owner remains byte-identical because it hashes its own source. A supplied
unsealed oracle context now refuses by name instead of silently changing holder
ownership. Governs [the workflow](../../workflow.md#decisions).

## Job keys keep their measurement basis (11-12)

#733 binds each memory-history key to a whole job or a worker before admission,
under its existing flock. Every sample retains its whole peak and measured
width. A caller changing the meaning of `--workers` refuses by name, and the
writer checks again while locked. `steps-v5.json` imports the old file only
before first publication: historical candidates can still write their old
namespace. Compatible step rows survive. Legacy job observations have no
recoverable basis or width, so the migration names how many it rejected and
each job measures one live-accounting run. Governs
## Imported tooling modules evaluate synchronously (11-12)

A guarded top-level await still makes every importer's graph asynchronous.
The no-await source rule therefore covers runtime imports as well as Worker
closures. Commands share `runAsCommand`, preserving their own handled
diagnostics and exit codes; asynchronous fixture setup belongs in test hooks.
Import-for-execution becomes an explicit exported function call. Type-only
imports are erased and do not make an execution graph asynchronous. Governs
[the machine](../../workflow.md#the-machine).
## One owner for Rust test builds (11-12)

Every Cargo test route now goes through `tooling/gate/test-profile.ts`, which
constructs the arguments and environment, validates the manifest and checks
Cargo's emitted artifact paths. The profile is incremental `nts-dev` with
`debug = 0`, overflow checks and debug assertions. Conflicting profile or
incremental settings refuse by name, and the source audit rejects direct test
builds outside the owner. The inner loop, frontend's native invariants,
workspace replay and doctests share it. The temporary dev/nts-dev equivalence
in landing receipts ends; producer and importing core name the same profile.

The frontend's bare Cargo call built a second debug artifact set, and the
workspace runner's incremental override made another variant of the same
profile. One invocation owner prevents both from returning. Existing obsolete
profile generations stay under the separately approved reclamation policy.
 
## Count bands are empirical per column (11-12)

The count header reads a tool-written results record, with retained samples
and provenance, instead of one source constant shared by all columns. The
recording owner derives each observed range from that column's own cohort.
The real wiring control requires counts and accepted checksums from every
column and tight native repeatability; it reports JIT spreads without refusing.
Supplied-count controls prove that native drift refuses and JIT tiering draws
do not. The initial cohort has twenty unchanged `fib` runs; its numbers live
in `results/benchmarks/count-bands.json`.

JIT tiering moved instruction counts with load and refused unrelated landings.
Increasing a finite band would leave the same probabilistic verdict in place.

## Active build disk promises (11-12)

The disk capacity owner counts only active Git leases and live build claims.
Its cold forecast is measured from the declared nts-dev and Clippy outputs;
partial allocations consume it, completed compatible owners release it, and
free checkouts promise nothing. Pool takes and build claims use the same lock;
temporary admission reads the same floor and outstanding promises. All Clippy
routes share target/clippy. [Contract](../../workflow.md#the-machine).
## Step handoffs retain the next demand (11-12)

The gate's give-back calculation retains the larger of its next known demand
and its active grants, withheld memory and slack. Higher-rank yield keeps its
existing rule. The ledger's admission order cannot protect growth that the
runner has not published yet: releasing memory first gave a later neighbour
a real window to enter at a step boundary.

The forced-handoff controls pause only a private staged runner. With the old
calculation the neighbour enters in that window; with the fixed calculation
it waits until the admitted run's next step completes. The higher-rank yield
control still passes. The original refusal was the ordering control in landing
run `61cb59a50b5c-1794494563299`; it was a handoff defect, not a verdict based
on elapsed time.


## Compiled cleanup follows observed ownership (11-12)

A landing unrelated to the compiled-call supervisor failed because a SIGKILLed
owned group did not disappear within three seconds on a loaded machine. The
supervisor now waits for observed group exit with a five-minute wedged-cleanup
backstop, whose instrument error names the group and remaining PID/state/start
identities. Its clock is part of the process probe, and inactivity, progress,
runaway and delayed-cleanup controls replay supplied observations. A real
owned-group control crosses the former bound on supplied time after a readiness
barrier; the C and JVM protocol controls retain generous hang guards. #744.


## Compiled cleanup is one attempt (11-12)

A close error can be followed by another close and then Drop. Re-entering the
wedged-cleanup wait at each call would multiply the declared backstop. The
compiled-child owner now retains the first cleanup success or named failure,
and later calls return it without another observation, signal or wait. A
supplied-state control checks both terminal outcomes. #744.

## Source inspectors share structural facts (11-12)

The test-host audit shares one structural index per module across its
inspectors, including lexical bindings, parents, calls and declared module
edges. Selected generated sources share their own index. Parser leases are
batched at sixteen modules or two MiB, with an oversized module inspected
alone and leases released immediately after use. Shell command facts retain
redirections without adding another policy.

Separate inspector walks had grown the audit's cost each time a rule joined
it. The fixed-tree inventory is unchanged, and locked instruction counts show
the shared index removes work. The higher bounded peak is accepted at its
measured size. [Measurement](../shared-source-facts-747.md). #747.

## Case retirement has an owned lifetime (11-12)

Worker close starts once and exposes a closed promise. The worker keeps its
scope until its final peak reaches the case broker; its parent stays until
every worker has drained. Token completion sends done and FIN after that
drain. Commands, resident pools, serial re-entry and shutdown await the same
boundary. A departed broker and the five-minute wedged-peer guard produce
named cleanup instrument failures, never product failures.

The runner's contended ledger cleanup waits asynchronously in flock while the
parent retains the lock's open file description. The free-lock path still
deletes immediately. This keeps the broker's event loop serving retirement
requests instead of waiting synchronously for the directory lock.

The old thirty-second synchronous retirement refused the full check's types
and example-refusals steps. The retained investigation and matched controls
are in [the retirement record](../case-retirement-752.md).
## A revert requires a fresh as-is main probe (11-12)

The full check bisected an older JVM-verifier failure after its host-infrastructure
handoff had been fixed forward. It could ask for a partial revert of the case
lease work even though newest main already had the fix. The search now probes
the failed steps on newest main with every culprit left in, records a green
as fixed forward, and bisects only steps still red. The deciding probe remains
valid across unrelated changes by the endpoint-union owed rules; changed inputs
allow two re-probes before a named hold. Unknown reach fails closed.

A flaky green that temporarily says fixed forward is accepted: the next core
catches it again, while a wrong revert removes working code. Fix attribution
names the deciding main commit instead of spending more suite runs finding the
first fixing commit. #754.

## Historical culprit observations belong to one search (11-12)

A changed-input main probe must not repeat an immutable historical bisection.
Within one search, retain observations per step and reuse the same red-step
set's result. Attribution stays per step: if c2 breaks A and c5 breaks B, a
main fix for A cannot turn c2 into B's culprit by filtering the union result.
A remaining step with no established culprit gets its own search, reusing
only established observations. No memo survives the search. #754.

## Contributor proof uses the prepared inner loop (11-12)

Contributors run `inner.ts --no-agree` for the Rust proof. It seals the oracle
environment, builds the compiler and sets NTS_BIN, installs the scratch runner,
and passes the touched crates plus all backends to the shared test invocation
owner with NTS_CHECKERS=1 and --no-fail-fast. The direct invocation owner does
not prepare runtime services, so its former documentation produced differential
test failures for missing setup. The dependency fixture also declares its
normal standalone oracle setup hook. Part of #753.

## Controller adoption precedes scheduling (11-12)

The follow-verified check could decline to move a locked controller tree and
then let the old controller start another run. Its later planned exit left
that run with a false held verdict. Pending adoption now stops scheduling
independently of the tree move: each cycle and core, wide or probe launch
checks it. The status names the verified target while the lock is busy.
In-flight work finishes, and independent records and benchmark units remain
adoptable. A restart request produces no held result. Fixes #755.
## Oracle records own their identity inputs (11-12)

A CLBG workload declaration changed the generated population while its older
budget record remained. The native reader correctly refused the stale key,
but the retained record hid the need for fresh recording. The fast records
check now classifies all row identity inputs, validates the cheap tree inputs,
and names native-plan gaps. A changed input deletes the stale fixture record
in the same change, making it pending. Reasons and formatting are not workload
constraints; measured body-only edits keep their count promise.

One incomplete benchmark also made finishBenchmarks return before publishing
its independently completed rows. Completed pending and accepted updates now
publish before the batch reports its remaining failure. The parent already
published audited deltas despite recorder errors; that behavior stays.
#592.

## Owner locks publish before they can be read (11-12)

The wx-then-write owner file let a contender read an empty file and remove a
live lock. Atomic link publication closes that window. A second barrier showed
that publication alone still allowed a stale dead-owner read to unlink a new
live owner. Reclamation now holds a short sibling flock, rereads, and removes
only the same still-dead identity. Normal holders retain the boot/PID/start
lifetime and hold no inherited descriptor. Malformed owners are named and
preserved for explicit recovery. The old valid format remains readable across
the landing service's restart. Unpublished candidates from dead PIDs are
collected under the same reclamation flock, including when the crash happened
before any public owner existed. A reused PID conservatively delays cleanup.
Fixes #762.
## Verifier setup belongs to the run (11-12)

The JVM verification step repeatedly compiled its driver through the Java
source launcher. It now compiles once in run-local storage and launches one
isolated JVM per project's emitted output. The driver source, javac identity
and compiled classes enter the artifact key. Full-population comparisons
retain identical verifier facts and decline summaries.

The zero reuse hits came from baselines containing an earlier pre-entry
DBUS/XDG failure. The shared store had kept those first observations forever,
even after verification completed. Only complete verifier facts now enter
it; the same validator discards invalid existing baselines under a repair
lock, leaving future formats untouched. Run logs retain infrastructure
failures. The controlled before, after and repeated runs, with their separate
CPU bases, are in the #759 proof summaries and comparison record. Fixes #759.

## Git observers never refresh another tree's index (11-12)

The pool's status path could run Git's optional index refresh while another
agent wrote that index. Git arguments now have one pure owner that disables
optional locks for observation and mutation alike; required mutation locks
remain enabled. A syntactic rule checks command positions and selected
generated sources, using the shared facts. Remaining sites have exact
source-keyed counts that only fall, so removing one cannot permit a new one.
The control forces a stale index with optional locks explicitly enabled,
proves a private before variant refreshes it, then checks unchanged bytes and
write statistics with the argv owner. Production owners are the first slice.
Part of #763.

## Oracle-preload leaves own one-file projects (11-12)

The pure Git argument owner moves to its own directory and project, as
command-entry did. An import from oracle-dependencies otherwise compiles the
whole gate project and reaches cross-directory roots outside its rootDir.
Shared leaves reached by an oracle preload each own a one-file tsconfig.
Part of #763.
## Fixtures own only declared data namespaces (11-12)

Reader declarations distinguish module-owned inputs from branded data
directories. A fixture grant substitutes only an already-declared directory
at its own destination, names its fixture owner, and records that owner with
the declaring readers in the staged manifest. Imports, entries and URL-declared
module inputs always retain production bytes. Without a grant the copier
stages every declared data member. This lets reader declarations grow without
either copying a real corpus into every small fixture or reviving dependency
lists. Shell/Python launches retain the parsed JavaScript continuation while
inferred edges remain unable to discharge an unknown path's full gate.
Part of #728.

## Pending growth follows current demand (11-13)

A supported local check had finished its running steps and needed one more
GiB, but its queued growth still asked for eleven GiB from when Rust was
running. The larger request could not fit, so the empty run waited for itself.
The runner computes the rounded, capacity-limited current gap before inspecting
the pending ticket, withdraws an excess, and schedules a replacement only after
the old promise settles. Useful partial grants remain queued. A grant racing
cancellation is retained once and its excess is returned through normal shrink.
The admitted ancestor's rank and order remain unchanged. The private before
replay fails on the observed stale state; the corrected runner completes without
any host-memory change or elapsed-time verdict. Fixes #769.
