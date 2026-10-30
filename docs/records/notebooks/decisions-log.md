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
  ([workflow](../../contributing/workflow.md#decisions)).
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
  [workflow](../../contributing/workflow.md#roles).
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
  ([Calling C](../../targets/calling-c.md#later-nodeffi)). The node reference
  still moves to Node 26, as an item of its own.
