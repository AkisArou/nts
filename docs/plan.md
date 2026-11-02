# The plan

What is being built, in what order, and what each step waits on. This is the
one page that changes as work goes; the designs it builds are in
[`foundations/`](foundations), and the questions still open are in
[`open-questions.md`](open-questions.md).

## Priorities

- **Foundations and correctness in parallel.** The foundations (the memory
  analysis, bounds-check placement, typed containers, strings, numbers, the
  builtins mechanism) are the main line, until each reaches its designed
  performance. Bugs are fixed beside them by their own agents: a silent
  wrong answer before a refusal, which is safe, and both in the order of how
  much real code they affect. The TypeScript suite's families are measured
  as test262 is: their failures are recorded and flip as fixes land, and
  they do not set the order of work
  ([log](records/notebooks/decisions-log.md#team-and-priorities-11-01)).
- **Primitives before test262.** The test262 records keep gating, but no new
  test262 family starts until the foundations are solid.
- **Native (C and LLVM) first.** The JVM and Wasm are kept in mind and designed
  after native.
- **Land everything worth keeping before new work,** whoever wrote it.
- **Features and conformance first; compile time is guarded, not chased:** a
  compile-time tripwire per module in the gate, and super-linear blow-ups fixed
  when found.
- **A builtin must not mask a compiler gap.** A row that loses because ordinary
  TypeScript compiles badly is fixed at that general cause first; a specialized
  builtin comes after, on top.

## Now

- **The switch to [how we work](workflow.md) (11-07).** The landing check and
  the full check are on `main`. Every change lands through
  `node tooling/landing/check.ts`, one at a time against the newest `main`,
  in ten minutes or less; the old lander and the lane machinery are gone.
  Tests and benchmarks land without records: the full check writes them.
  Left for the switch: the full check's unit, the worktree pool, the
  machine's cleanup of the old lander's folders, and agents restarting on
  the tasks below, one agent per task (the user decides which and how many).
- **In flight:**
  - the gate's memory admission (#335, `tsrs/335-gate-memory`), held;
  - Chromium, paused by the user (`chromium/counter-tree-profile`), its trees
    kept with it: `~/Projects/nts-lanes/chromium`,
    `~/.cache/nts-chromium-checkpoint1/context-control` and
    `~/.cache/nts-chromium-checkpoint1/scoped-harness-61e0020e9`.
- **The machine:** one shared 32 GB box; CPUs 4–5 are kept for measurement
  ([`../AGENTS.md`](../AGENTS.md)).

## Tasks

The queue, in the order it is taken: wrong answers first, then aborts and
failed builds, then refusals by reach, then the foundations and performance,
then tooling. A task whose work is already on a branch names it, and the
branch goes when the task lands or is dropped. The numbers are the old task
ids, kept so the records that cite them still resolve.

**Wrong answers**
- Decorators are compiled away; refuse them by name until the standard
  semantics exist (#14).
- Stored callbacks and catch roles (#188):
  `tsrs/3b-mainac1b-namespace-source-preview`; apply 3e8c1cab3 alone (three
  conflicts), build, record, and check the schema version.
- Writes inside implicit calls are lost (#113 A), with Navier-Stokes' build
  (#138): `compiler/implicit-member-call-effects-025`, about 7k lines to
  rebase; skip its evidence commit.
- A program's own Math, `Number.isNaN`, `parseInt` or typed-array class is
  replaced by the builtin (#129).
- Map and Set contents (#158, with #203's typed Map view): the writer planner
  on `compiler/collection-tagged-semantics`, after a design note; it should
  fix the two `a-widened-map-read-through-its-original-view` outcomes.
- Generics: a generic called from a generic is instantiated at its constraint
  (#212), private fields across instantiations (#237), invalid HIR from two
  instantiations (#231), a record's number field reads 0 on the second call
  (#205).
- A narrowed field survives a callback that replaces it (#180); a key absent
  from a `Record` reads as present (#211); `String()` skips an object's own
  `toString` (#221); deleting a field that shadows an inherited getter (#286);
  an inherited getter read treats an instance as a Map (#284).
- Private names: `#x in this` during initialization (#233), methods without
  identity (#234), a static private read through a subclass (#235),
  same-spelled private names (#236).
- Numbers: wide integers in power-of-two bases (#262), a definite-assignment
  assertion taken as a write (#263), a TypeError node does not throw (#264).
- The rest of #190's wrong answers, by reach.

**Aborts and failed builds**
- A rest parameter reads the second argument (#209); `Array.isArray` over a
  typed array (#208); a refused function called through `{ size }` (#161); a
  class called with `.call` through a construct signature (#222).
- Preserve `number[]` element storage through nullable `Array.isArray`
  narrowing ([defect](../tests/outcomes/a-nullable-array-narrowing-reinterprets-typed-elements/src/main.ts),
  [control](../tests/outcomes/an-array-narrowing-without-the-null-union/src/main.ts)).
- The compiler stops: recursive aliases through Map/Set (#200), `parseInt`
  through a widened interface (#260), property names that are not C
  identifiers (#165, #227), an export name with no C spelling (#134: refuse
  it in a public `program.h`, escape it in Node-API's private one),
  `new Array(-1)` (#312).
- Generated code is rejected: C for constrained generics (#310), LLVM's
  missing declaration (#311), a JVM VerifyError (#265) and ClassCastException
  (#215).
- The JVM backend never finishes compiling `jetstream-threejs`: its compile
  record says `timeout` once the full check writes it. Reduce it to an
  outcome fixture.
- Type-checking `jetstream-json-stringify-inspector`'s data (7.3 MB of one
  object literal, as upstream recorded it) takes minutes on the native
  checker: measure it against `tsc` on the same file, and report it upstream
  if the cost grows faster than the literal.
- Array holes have no representation (#143).
- A class exported from an LLVM addon makes it fail to load (#181).

**Refusals, by reach**
- Exceptional transfer through indirect calls (#18): build the producer per
  [the design](records/notebooks/exceptional-transfer-and-activation-design.md).
- Octane: `Error()` without `new`, and `new.target` (#147's rest).
- Undefined reads: uninitialized-field occupancy (#33), then value-owned
  property attributes (#229).
- Function values exported through Node-API (#149), after the shared reader
  fact and both backends' switch: a real `napi_create_function` holding the
  native closure, one reference owned by the JS function's finalizer, one JS
  identity per closure.
- Strict-mode unmapped `arguments` (#55), `instanceof` a const alias (#182),
  `bigint[]` push (#189), object statics over unknown layouts (#187),
  typed-array subclass species (#186), the absent-routes refusals (#178), key
  order (#179), a union's dictionary arm (#278), Proxy without traps (#173),
  JVM interface field accessors (#327), generic methods on generic classes
  (#267), printer admission (#146), Math gaps (#206), `parseInt` whitespace
  (#214), runtime library statements cut (#16).
- A lib.dom alias returned as a different opaque type must refuse (#275), with
  Chromium's fixture on `chromium/svg-value-types`.
- Node: native `process` conformance (#287) and the nine held node tests
  (#238).

**Foundations and performance**
- Memory: stage 1 (#12); stage 3's arena API comes from
  `refs/cited/252b3ba25611` with its first caller; a field overwritten in a
  loop leaks (#126), its fixture on `helper4/lifetime-field-overwrite-finding`
  landing with the fix.
- LLVM at least as fast as C (#97): `compiler/llvm-linkage-nsw`; land
  7858d092d (nsw and final-link preemption) with LLVM benchmark rows, then
  rebuild linkage by product and emission pruning on today's
  `SourceSymbols::is_public`; descriptor initializers from one renderer
  (#248).
- Typed scalar numbers (`Int32`, `Uint8`, `c_int`, `CGFloat`) have a design
  from an earlier experiment:
  [its notes](records/notebooks/scalar-numbers-playground/README.md).
- Proved-integer arithmetic (#28): the integral producer and its two passes,
  rebuilt from
  [its notebook](records/notebooks/integral-arithmetic-regions.md); the
  bounds relational domain (#96).
- The builtins mechanism (#42, #137), capture by value (#184), identical
  instantiations sharing one body (#192), per-site copies for union
  parameters (#154), the verifier (#257, #266, #285), the view kind as an
  integer (#207).
- Calling C stage 2 (#91): `runtime3/c-number-kinds-clean-stack`, about 8k
  lines in 12 conflicting files, renamed after the native naming change, then
  the five C records.
- Every row at the bar (#94): `parseInt` (#243), the JVM's int-cursor reads
  (`refs/archive/jvm/jvm/int-unit-at`), the comparators as standing columns
  (#89).
- Compile time: quadratic loops (#115), the 237x regression (#122),
  ai-astar on the JVM (#334).
- Managed-type coercion inside the compile-time budget (#159, with #185's
  fix): `compiler/managed-coercion-main102-r10`, its clean history on
  `compiler/managed-coercion-history-draft-r1`, whose last commit records
  the measurement that put it far over the budget (11-06). Parked until
  compiler work restarts; the cost is not yet attributed.
- The JVM class archive (#148), JVM interop (#21), Zig as the bundled C
  toolchain (#44, a product decision for the user).

**Benchmarks and the web platform**
- The four Brotli rows, compress and decompress at 1 KiB and 1 MiB (#71),
  after one build driver for the CLI and `nts-bench` (#196).
- The asynchronous benchmark harness (#56), then the parked JetStream pull
  requests #69 to #74; #118 after its licence check.
- AWFY Richards and DeltaBlue stay off `main` until a licence allows
  redistribution: their only one, an archived Sun Labs page, grants none
  (their ports are on `helper/awfy-ports-parked`). Octane's BSD versions
  cover both workloads.
- `bench-agree` records each benchmark's run outcome per backend, with pending
  and the ratchet like the other records, so a known failure is a recorded
  finding instead of a red step. Until then `awfy-json` and `awfy-storage`
  stay pending: both abort on the JVM with a `VerifyError` (#265).
- 37 benchmark ports (the 35 JetStream ones, `clbg-pidigits` and
  `clbg-regex-redux`) need a `case.domains.json` before their oracle counts
  can be recorded: the recorder's pool reaches inputs outside their
  workloads, so they stay pending.
- Whether `main` bootstraps the source globals another way, or the
  `chatgpt/source-globals-bootstrap` branch is still needed.
- The WebSocket server goes (#52); the interface tag sweep (#53).

**Tooling**
- The landing check's own `nts-dev` build (`landing/run.ts`) has no time
  bound yet; `NTS_BENCH_AGREE_FLOOR`, now unread, leaves the canonical
  environment after #193 lands.
- `bench-agree`'s run record keeps an abort's first line, which can move with
  unrelated codegen (a `VerifyError` names a method and a bytecode offset):
  record the abort's identity instead.
- The TypeScript and test262 suites as sampled landing steps
  (`typescript-sample`, `test262-sample`), so a compiler change runs a slice
  of them before it lands.
- The `tests` step is the landing check's critical path (about five minutes on
  eight slots): measure it wider.
- Dead code the old lander left: the read side of `resource-comparison.ts`, the
  strict landing classification in `owed.mjs`, `run.mjs`'s train red-stop, and
  `census/full.ts`'s use of the old landing lock.
- A candidate that does not compile is held, not refused: the landing check
  reports it red (#46).
- One format rule for all owned C; the web-platform suite as a landing-check
  step (#46).
- Thirteen tools still stop work on fixed wall-clock deadlines (#83):
  definitions, messages, erased-calls, semantic-codes, assembles,
  emitted-diff, attempt262, outcomes-check, test262, layouts-link, agreement,
  blocker-reach and blockers-check move to the active-command observer.
  A definite failure outranks a hang (#87).
- The TypeScript families the new oracle can judge (#195, #276); the JVM jar
  built from `JAVA_HOME` (#194); type-check coverage of tooling (#281);
  ratchets that record their own progress (#74).
- Every tool's scratch folder lives under the run's `TMPDIR` and is removed
  on every exit path, so a stopped run leaves nothing behind (on 11-06,
  stopped runs had left 167 GB): `conformance262.ts` in #193, then
  `outcomes-check.ts` and the rest; it includes the per-case temp folders
  tests leak (#197). Tests already keep theirs there through
  `tooling/gate/test-scratch.ts`. A gate run by hand keeps three days of its logs
  (`~/.cache/nts-gate/runs`), as the landing and full checks keep theirs.
- `tooling/cli/tests/case_roots.rs`'s
  `native_checker_errors_keep_their_count_diagnostics_and_exit` once found its
  own scratch folder already gone when it removed it (`remove scratch:
  NotFound`), though the folder's name is unique: find what deletes inside it
  after the CLI exits, a child of `nts` outliving it being the first suspect.
- The old lander's open defects fold into the landing check: #120, #121,
  #133, #135, #139, #141, #176, #216, #223, #271, #273, #290, #299, #300,
  #330, #332.

## The phases

| phase | what | state |
|---|---|---|
| 1 | Settle `main` | finishing; what remains runs beside phase 2 |
| 2 | Foundations, native first | the main line; memory and Unicode designs decided |
| 3 | Conformance-driven development | paused; its records keep gating |
| 4 | The JVM and Wasm on the same foundations | after phase 2 |

Benchmarks run through every phase.

## Phase 1: settle main

1. **The tsrs switch.** *Done.*
2. **What tsgo left behind.** *Done:* the binary is gone, and nothing reads
   `NTS_TSGO`.
3. **The memory defects the outside review found.** *Fixed*, with region and
   frame allocations kept within their proved lifetimes, and the frames that
   fix gave up restored; the follow-up is in its landing gate.
4. **The gate,** in this order:
   - a red train blames only the landing that caused it, and a failure that is
     already on `main` is reported as red on main (*done*);
   - the reference-counting and memory checks run on every compiler and runtime
     landing, not only in the full run (*done*);
   - deliberate crashes store no core dumps, so measurement can start beside a
     gate (*done*);
   - no cold build per train: tests are built with line tables only, at
     opt-level 1, and the debug build folder is pruned within a bound (*done*);
   - every step runs in one canonical environment, whoever launches the gate
     (*done*);
   - the compile-time tripwire counts every compiler thread from the start,
     against a threshold set from repeated runs of one binary, and the
     reference-counting build has a row of its own (*done*);
   - the compile-time guard adds backend code generation and link time (P-6);
   - native instruction counts per benchmark row gate the full run, against
     the noise band, starting with the counting drivers (P-5);
   - a nightly full run and a weekly one with result caches off; `--touching`
     only once a test proves it selects deterministically (Q-3);
   - a sanitized, reference-counted differential run over the whole corpus in
     every full run (Q-7);
   - a per-case ratchet on the conformance records, changed only through
     reviewed `results:` commits (Q-4);
   - the web platform's own suite as a gate step, owed by every change to
     `runtime/web-platform`;
   - what a change owes is the union of `main`'s rules and its own, so no
     change narrows its own gate;
   - one format rule for every C file nts owns.
5. **The fast landing model** (approved):
   1. a change owes only the checks it can affect, so docs, records and
      comments land in seconds, with no train (*done*: the fast lane);
   2. the gate's waiting is fixed, its results are cached by their inputs, and
      only the cases a change can affect run, for a full gate near 10
      minutes. *Waiting fixed:* frontend capacity follows the CPU slots,
      reservations only for steps that can fit, memory budgets calibrated from
      measured peaks, and `blockers` runs in parallel. *Caching:* keyed on
      artifact bytes; the JVM verifier's results are reused, and the other
      kinds stay in shadow mode until their results are proved identical. An
      inspection program is prepared once (*done*). Next: one capture per
      project per run, shared by every step;
   3. then code lands after a 5–10 minute check, while a verifier gates `main`
      behind it, bisects a red and reverts the culprit automatically. Changes
      to the gate itself stay strict. *The ledger and the shadow verifier are
      on `main`;* optimistic landing waits for three shadow batches that agree
      with their trains (two have), then for the holds, bisection and brake,
      which come next.
6. **Deterministic builds:** the same source and compiler give the same bytes
   on every backend, held by a test over each of them ([cli](reference/cli.md#nts-build)). *Done.*
7. **The documentation** as specification pages, with the notebooks in
   [`records/`](records). *Done.*
8. **The register's wrong answers** recorded as fixtures: decorators dropped,
   throws escaping `try` through closures in fields, overrides and method
   values, and a method read twice being two functions (*done*); the
   covariant-array dispatch remains.
9. **A citation sweep:** code comments that cite documents moved to
    `records/` (*done*).
10. **Exact verdicts:**
    - the integrity audit counts every statement a refusal cuts, and every
      known cut names its cause (*done*);
    - the differential oracle compares a recorded number of cases per
      project, measured complete, under a CPU-time bound, so what a gate
      checks never depends on the machine's load (*done*);
    - a wall-clock deadline decides no result anywhere in the gate (*done*).
11. **The silent wrong answers found on the way,** in this order (a store
    that would close a cycle now keeps a counted root, so a closure that
    captures `this` no longer leaks: *done*):
    - an optional callable property in a structural type (the node stdio
      setup, *done*), then one writer per stream for `console.log`,
      `process.stdout.write` and the node `console` (*done*);
    - a project that is not `strict` is refused, naming the flags that are
      off, all nine, as NTS1006 (L8, *done*);
    - decorators refused until implemented;
    - a throw through any indirect call is catchable (L15), so a failed
      check of an erased value is always a catchable `TypeError` (L6);
    - the web-platform classes keep their functional setup out of the
      reflective setup that nts defers;
    - any refusal fails `nts build`, with `--partial` for experiments (L20),
      so a refused program never runs with parts cut (*done*);
    - reads that JavaScript answers with `undefined` give `undefined`:
      holes, uninitialized and `declare` fields, a `var` read before its
      assignment, reads past the end (L4, X1). They are built on one shared
      representation of a possibly-undefined value, the same one typed maps
      use for absence (in progress: the shared representation first);
    - native `setTimeout` clamps its delay as node does, with a two-arm
      fixture that pins HTML's rule too (C-6).
12. **A diagnostic registry** (L21): every code with its meaning, whether it
    is permanent or "not yet", and its message.
13. **The library ABI version** of record 0018, with result caches keyed on
    the schema, compiler and runtime digests (X-7).

## Phase 2: foundations, native first

The designs and their build orders are in [`foundations/`](foundations).

1. **Instruments before mechanisms:**
   - the memory census, whose numbers set the retention bound (M-1);
   - the memory rows: `tree-teardown`, `sort-objects`, `release-acyclic`,
     `immutable-update`, `array-copying-methods`, `cyclic-churn`;
   - the six remaining Are We Fast Yet ports: Richards, DeltaBlue, Havlak, CD,
     Json and Storage. With the eight already on `main`, that is the whole
     suite of fourteen, against node, Bun, C++ and Java. They land as rows
     that nts refuses until three compiler gaps, recorded as fixtures, are
     fixed: a nullable generic array property (four ports), Richards'
     module-scope sentinel, and Storage's recursive array return;
   - more ported suites, by cloud agents: the Computer Language Benchmarks
     Game (nine programs, with C++ references), Octane (five) and ARES-6
     (four), each landing as it is reviewed, with declared input domains
     for the generated cases;
   - the Unicode rows (`case-convert-latin1`, `-greek`, `-cjk`,
     `-unchanged`), the new-letter fixtures and the version-pin check (*done*);
   - startup time, executable size and peak RSS rows, against node and Bun
     (P-2);
   - a differential program fuzzer (Q-6).
2. **Memory stages 1 and 2** (cheap counting wins; the one placement analysis,
   facts only), beside **Unicode stage 1** (case mapping: built on C and
   LLVM; the JVM's tables are next). Memory stage 1 so far:
   release by type, the count-free sort, proved-integer `Math.min` and
   `Math.max`, and typed collector visitors are on `main`
   ([results](../results)).
3. **Typed containers:** `Map` and `Set` stored by the proven layout of their
   keys and values (raw integers, doubles and references, with boxed values
   only where they are dynamic), absence carried by the shared
   possibly-undefined representation, and map reads that a loop cannot
   change hoisted out of it. Content facts and proved-int32 arithmetic are on
   `main`; the design is approved, and the shared representation is being
   built first.
4. **Then:** memory stage 3 (per-site regions, json-parse first), Unicode
   stages 2–3, the strings stages D and E (E's SIMD conversions also serve
   `TextEncoder`, `TextDecoder`, `atob` and `btoa`), numbers, and the keyed
   hash.
5. **The builtins mechanism** ([builtins](foundations/builtins.md)), approved,
   with WinterTC's Minimum Common Web API as the web floor on native and the
   JVM. Stages 1 and 2 are on `main`, and stage 3's resolver is being built.
   JSON's move to `runtime/ecmascript` is ready. `URL` moves to
   `runtime/web-platform` in stage 3, as a canonical implementation that
   depends on nothing in `runtime/node` and that node re-exports. Both become
   reachable in stage 5. The clock and randomness come with stage 6. Decided
   for it:
   - the floor's missing APIs in `runtime/web-platform` taken by cloud agents
     through pull requests ([cloud-agents](contributing/cloud-agents.md)): the
     web platform's conformance, Web Crypto, WebSocket and EventSource, with
     their first pull requests landing;
   - WebSocket as the client only: the server code in `runtime/web-platform`
     is removed once the realtime pull requests have landed, and the client's
     conformance tests get a peer of their own;
   - the host libraries built from the pinned node's own sources (OpenSSL,
     brotli, zlib, zstd and libuv), so that nothing nts builds links a system
     library; today the machine's OpenSSL and brotli are linked;
   - Brotli for `CompressionStream` and `DecompressionStream` once the
     compression pull requests and the host libraries have landed, then Web
     Crypto's Modern Algorithms, as node implements them, once the Web Crypto
     chain has landed. The Web Crypto cloud agent writes the TypeScript and its
     maintainer the native half;
   - `runtime/sdk` becoming `runtime/app` (`@nts/app`), its web-standard parts
     moving to `runtime/web-platform` and its lib subset retired;
   - the floor's `WebAssembly` API last, through an embedded engine linked
     only into programs that reach it;
   - `node:*` for native programs at stage 9, with a `node:` resolver and the
     `process` and `Buffer` globals (G10), and beside it nts as a Node-API
     host that loads `.node` addons such as `sharp` (research first: I-10);
   - `console` formatting values as node's `util.inspect` does (G18), and
     randomness and crypto from each target's own sources (G16);
   - an untyped `JSON.parse` served by the TypeScript parser until the
     compiler has its own (G9).
6. **The dependency policy** (D-1), written as a foundations page.
7. **Licensing:** nts becomes Apache-2.0 WITH LLVM-exception, so its own runtime
   owes no notice in programs, and FFC is used under BSL-1.0 (*done*).
   Then `nts build` writes the notices file for the third-party code a program
   links.
8. **Bounds-check placement** (decided,
   [objects](foundations/objects.md#arrays)): one relational analysis in
   `compiler/core`, whose rule for what a call ends is a whole-program summary
   of the effects that can change a length. The compiler lane builds it after
   the flow fixes have landed and the validation build's mode exists. Loops
   it cannot clear are versioned through runtime2's loop versioning (the
   integral regions). Each step is measured per row by instruction counts and
   by the checks left in the hot loops' machine code on each backend
   ([evidence](records/notebooks/bounds-check-placement.md)).
9. **Calling C** (decided, [calling C](targets/calling-c.md)), built in
   parallel with the rest of this phase: the C API as each header declares it,
   written with TypeScript's values and checked against the header at every
   build. In this order:
   1. **The vocabulary:** branded struct classes over C memory with their
      fields as own properties (`new T`, read-only nested references that
      hold their root, `copy` and copy constructors), `Ref<T>`,
      `CArray<T, N>` with checked indexing, `addrOf` as a direct argument,
      `Handle` tokens, `CFunction`, `unsafeCast`, `cstring`, and `errno()`
      and `lastError()` saved where they are read. With them, the lifetimes
      and checks that hold everywhere: a lent value living to its block's
      end, stored pointers held by their object, a lent buffer never detached,
      what the program knew about C-reachable memory ending at each C call,
      an interior zero and a NULL non-null result as `TypeError`s, and
      callbacks only on the owner thread inside a C call, with or without a
      host (C-3, I-3). Then the checking build. `local<T>()` goes. Owner:
      runtime, with the compiler lane reviewing every core change, the
      lifetime rule and the end of facts at a C call above all.
   2. **The binder:** C's number types first, each kind also a value; then
      whole headers per target, type-checked against what every target of a
      build declares, with the type map of [calling C](targets/calling-c.md#types-at-the-boundary);
      nullability, enum openness, `counted_by` and the other attributes read
      from the header; constants, pointer casts included; C shims for
      function-like macros and `static inline` functions; variadic arguments
      of a C kind with `format` checked; the refusals (`va_list`, `setjmp`,
      a TypeScript signal or exit handler). Owner: runtime2.
   3. **The existing bindings** move to the new forms (`tests/interop`,
      `runtime/native/libc.d.ts` and its README), the hand-written ones
      included, so `Counted`, `CBytes`, `CStrings`, copied string results and
      `local` leave plain C and the fact tags stay only where metadata
      generates them. Owner: helper2, with the lanes whose bindings move.
   4. **Rows:** the cost of a C call, a struct-heavy binding and a
      callback-heavy one, each against the same work written in C and against
      node calling the library through a Node-API addon (owner: helper2).

   `runtime/node`'s libraries (libuv, llhttp, zlib, the crypto library) are
   the first bound this way. TypeScript's `using` and `DisposableStack`, which
   C handles can use, follow from the compiler lane after its soundness
   classes. `node:ffi` is kept in mind for later, not scheduled
   ([calling C](targets/calling-c.md#later-nodeffi)).

## Phase 3: conformance-driven development

When it resumes, there are **four suites, on every backend:**

| suite | checks | oracle |
|---|---|---|
| test262 (upstream, unedited) | JavaScript semantics | the test itself |
| TypeScript conformance (`tests/typescript/`) | TypeScript's run-time semantics, and the typed paths of every type-system concept and their pairings | the test itself; every case first passes on node |
| TypeScript's own tests (upstream, unedited) | compile robustness (no crash, no invalid output); the executable ones agree with node | node running TypeScript's emit |
| generated programs | interactions between concepts nobody wrote by hand | node; each program prints a hash of its results |

**Representation is checked, not assumed:**
- `expect-ir` facts on cases;
- `nts stats` counters per program;
- one benchmark row per concept family on every backend;
- an A/B switch for each representation decision.

**Three tiers of performance checks:**
- representation assertions, at every landing;
- concept benchmarks by instruction counts, in the full run;
- cross-language suites, in the full run.

**The machinery:**

| piece | state |
|---|---|
| the core gate per landing, the wide steps in the full run | built |
| `inner.ts`, the gate's own commands before review | built |
| the full run (`tooling/census/full.ts`) | built |
| test262 records on C, LLVM and the JVM | built |
| the TypeScript conformance suite, with records per backend | built |
| `emit --backends`, and choosing the cases a change touches (`--touching`) | partly built |
| a persistent cache of frontend results | none: the frontend captures every request |
| the program generator | not started; built as a phase 2 instrument (Q-6) |

When `--touching` exists, the rule "run the five test262 records before the
gate" becomes "run the inner loop on every backend before queueing".

**The order of families:**
1. wrong answers and invalid output;
2. backend parity;
3. refusal families, by reach;
4. early errors;
5. decorators last.

**Language work decided for this phase:**
- the `arguments` object, unaliased (L2);
- proper tail calls: loops, guaranteed tail calls, trampolines on the JVM
  (L3);
- member reads on `any` and `unknown` by a run-time key (L7);
- JSX in the compiler's core, against TypeScript's JSX emit (L10);
- namespaces holding values, and declaration merging (L11);
- JavaScript's identity: a class per evaluation, cached method values,
  `new.target` (L12);
- `declare` as the environment's, with C only through `c:` imports (L13);
- every error JavaScript throws catchable, stack exhaustion as a `RangeError`
  once its cost is measured (L14);
- generators, the iteration protocol and `using`, in full (L16);
- top-level `await`, `import.meta`, and JSON and text modules (L17);
- one async ordering contract, held by shared fixtures on every backend
  (C-4).

## Phase 4: the JVM and Wasm

Both rest on [their foundations](foundations/jvm-and-wasm.md), whose open
proposals wait on research.

- **The JVM** resumes with a design per foundation:
  - Java's `String` with destination passing;
  - JSON's Java kernels;
  - a zmij port;
  - nts's Unicode tables (D4);
  - J2's table protection over `String` keys, with the keyed hash (X-4);
  - the paused `jvm/appended-results` work.
- **Wasm** is one WasmGC backend, browser-first, built through Binaryen
  ([targets](targets/wasm.md)). Wasm stays a target; its first implementation,
  the direct backend, is removed from the tree, the workspace and the gate,
  and archived, so the Binaryen backend starts from the design, not from that
  code. When it resumes, measurement
  settles:
  - whose strings the JS-hosted profile reads characters from;
  - how the standalone profile gets its runtime pieces (number formatting,
    hashing, Unicode tables);
  - Wasm's literal hashes, through the shared hash definition.

  Its products are `target.web()` and `target.wasi()`, with ES-module and
  component products (S-1).

## From the Bun and ScriptC studies

Two studies read Bun's ahead-of-time compiler and ScriptC against nts
([Bun](records/notebooks/bun-aot.md), [ScriptC](records/notebooks/scriptc.md),
merged in [the audit](records/notebooks/aot-studies-audit.md)). Their shared
first idea is nts's own rule: only a proof over every value that arrives and
every writer picks a narrow representation, never a declared type. What they
add, in order:

1. **Correctness, before any speedup they suggest:**
   - a **validation build** that re-checks at run time each fact the compiler
     used to remove a check:
     - removed bounds checks become named traps;
     - each narrowed number is checked where it is defined, against the
       original double operation recomputed from operands already checked
       (the inductive oracle, chosen over a full double shadow);
     - unreachable paths trap by name.

     The hand prototype on emitted C is clean: every sabotage control traps
     by its name, and it caught the merge-bound bug that ASan let through. It
     becomes an `nts build` mode (compiler). The mode records each rewritten
     operation's original recipe, keeps its checks out of the facts the
     optimizer trusts, and places its failure edges before reference
     counting. It runs over the differential corpus and the five test262
     records, and their cost decides its place in the nightly full run;
   - the adversarial routes as fixtures with one-difference controls on every
     backend: Bun's method-bivariance and covariant-array cases and ScriptC's
     variance case (helper2). A bivariant method receiving an erased argument
     gets a checked conversion at the callee's entry instead of invalid HIR
     (compiler);
   - array holes: the behaviour is decided (L4); an experiment on the array
     rows chooses the mechanism, a reserved NaN or a filled-prefix count
     maintained by writes (runtime);
   - at region reset, a check that no cycle candidate or collector work list
     points into the region, with a sabotage case (runtime).
2. **Experiments on the rows nts loses,** each on hand-edited emitted code
   before any compiler change, each shown with every ratio:
   - `cyclic-churn`: the collector's counters are measured. Every candidate
     is young, about two thirds of the bytes a collection visits are still
     live, and nothing is visited twice, so the adaptive trigger's condition
     does not hold. Its cycles survive many iterations, so resetting a region
     per iteration is not safe either. Nothing planned targets young
     candidates that are mostly still live: candidate aging and a trigger
     that follows the reclaimed share are each measured by hand on emitted C
     before a mechanism is chosen (runtime);
   - `json-parse`: a hand-written typed parser row against the
     hosts' native `JSON.parse`, with and without validation, to size the
     generated parser (helper2);
   - `awfy-towers` and `fib`: integer copies of the recursive
     functions, to decide whether argument ranges are proved through the
     recursion or guarded at its entry (runtime2);
   - `sort-objects`, `release-acyclic`, `immutable-update`,
     `str-split`: profiles, then one fact a fuller helper contract would
     supply (what a helper reads, writes, retains and calls back), kept by
     hand, to size the contracts of memory stage 0 (runtime);
   - after the call-heavy rows: the cost of the test after each call that may
     raise, which decides whether table unwinding pays (runtime2);
   - async calls, once the asynchronous benchmark rows land: a row that awaits
     a known async function in a loop, beside a control that awaits a real
     promise, with the emitted code entering the body without an intermediate
     promise. It is adopted only as a proof in the shared IR that keeps the
     order of queued microtasks, cleanup and iterator closing, so every async
     ordering fixture must still agree with node (helper2 for the row,
     runtime2 for the experiment);
   - the generator rows run at C++'s speed but lose to Bun's AOT compiler,
     so a hand-fused generator loop is measured against it, kept only as a
     proof in the shared IR that keeps the protocol's order (L16) (compiler).
   The 10-29 comparator sitting's loss record maps every row below
   [the bar](README.md#the-bar) to the item that covers it. These are the
   ones nothing covered:
   - `str-append-length` loses to all three engines while observing only the
     length: strings.md's condition for a rope is met, so its first choice,
     an internal segmented builder that materializes an ordinary string, is
     built and measured against a rope (runtime2, after the flow landing);
   - the numeric kernels (`awfy-nbody`, both Mandelbrot rows,
     `clbg-spectral-norm`, `bytes`, `checksum`, `array-predicates`, `loop`):
     the hot loop's machine code beside ScriptC's and Bun AOT's, to find the
     instruction-level difference before any design. Candidates include
     vectorizing independent iterations without reordering floating-point
     operations, and integral proofs (compiler);
   - `pipeline`: a hand-fused map and reduce against the materialized
     arrays, to size a fusion design (compiler);
   - the JVM-only gaps (`cyclic-churn`, `release-acyclic` and
     `clbg-spectral-norm` on the JVM): the JVM's collector and flags, and
     the object layout, measured per row (runtime2);
   - **the LLVM backend slower than C** on the rows the 10-29 loss record
     lists. The layout-interval instrument shows the gaps are real. Two
     causes are found by hand-editing the IR, and both are being built in
     the LLVM backend (runtime writes it, the compiler lane reviews it):
     - no-overflow facts: `nsw` on the signed operations the exactness
       analysis proves, the same fact that lets C use signed arithmetic. It
       changes `awfy-sieve`'s loop shape and its branch misses, not its
       instruction count, and passes C there;
     - linkage: in an executable, a definition the product does not publish
       is `internal` in LLVM and `static` in C, from one shared decision,
       so the optimizer can specialize it without relying on link-time
       internalization. This closes `json-scan` and passes C. A library
       keeps its external ABI
       ([native](targets/native.md#two-backends-one-runtime)).

     Then every row where one native backend trails the other is measured
     again, and the remaining gaps (`awfy-permute`, `array-methods`,
     `upcast`) are attributed the same way
     ([native](targets/native.md#two-backends-one-runtime));
   - **the C backend slower than LLVM** on the rows the same record lists
     (`dispatch` the worst): the same comparison the other way, to find
     what nts's LLVM IR gives the optimizer that its C loses (runtime, after
     the LLVM rows).
3. **Already planned, confirmed:** loop versions behind one entry test (the
   integral regions, being built), the generator protocol (L16), typed
   `JSON.parse` into its layout, helper contracts in memory stage 0, slices
   that point into their owner (strings stage D), startup and size rows (P-2),
   with a scaling test of unused code and a per-byte size report.
4. **Later, recorded:** per-operation integer speculation, 4-byte references
   after the memory census, data caches for dynamic objects (with L7), views
   at crossings, profile-guided builds, compile-time constants, link order.
5. **Not adopted:** declarations as proofs, observable copies at crossings,
   UTF-8 storage, ropes or locked builtins without a row, executable surgery,
   a collector change on an unattributed claim, any interpreter or engine
   fallback.

## Benchmarks

- **Are We Fast Yet,** all fourteen, against their own C++ and Java
  references.
- **Then a JetStream 3.0 subset, as a suite:**
  - pinned at the tag `JetStream3.0` and unedited, with about 16 compute
    workloads first;
  - out of it: GPL, LGPL and unlicensed workloads, the DOM, `eval`, `Proxy`,
    Intl, Workers and the Wasm workloads;
  - their refusals become a ranked backlog.
- **Comparators:**
  - native: C++;
  - JVM: Java;
  - Wasm: C compiled to Wasm, and AssemblyScript;
  - every backend: node, Bun's JIT and Bun's ahead-of-time compiler
    (`bun build --compile --aot`) from the same build, and ScriptC's native
    output with its Node fallback turned off (10-29), each held to
    [the bar](README.md#the-bar);
  - each at a pinned version, node, Bun, ScriptC, the JDK and clang included
    (P-4).
- **Instruction counts** are the regression signal between runs; wall time is
  for the ratios. Every result is shown with its ratios, the machine's
  conditions and the verdict.

## Backlog

Noted, not scheduled:
- `Map<K, number>` values stored unboxed (Bun 3.9× and Java 3.1× faster on
  `map-literal-keys`);
- `Array.prototype.flat`;
- intersection-typed parameters, a refusal family;
- one exit-code convention across commands, and the command line parsed once;
- a per-case ratchet for the TypeScript corpus;
- one hash definition in core, used by every backend, including Wasm's literal
  hashes;
- test262's `eval` and `Function` cases out of the denominator, citing
  boundaries (L1);
- line tables and `#line` in every build, frame pointers if cheap, an
  unoptimized debug profile, and `Error.stack` with node's uncaught-error
  report (X-1, X-2);
- promises across boundaries: a deferred plus a threadsafe function for
  N-API, and `nts_checkpoint` documented for C embedders (I-4);
- one nts instance per process, a second refused clearly (I-7);
- host errors as catchable `Error`s carrying the host value, as GError,
  HRESULT and `NSError` already are, with nothing unwinding through C frames
  (I-2, [calling C](targets/calling-c.md#callbacks));
- the per-target intersection type check (B-2), and publishing the
  permissively licensed surfaces (B-3);
- objects across the C ABI as opaque handles, then Swift, Kotlin and Java
  wrappers (S-2);
- prebuilt binaries per platform for npm (S-3);
- the Chromium app as a separate process with IPC (S-4), and Blink's errors as
  `DOMException` (G6);
- CommonJS dependencies through an interop layer (L18), and JavaScript-only
  npm packages compiled against their JSDoc and `.d.ts` types, with hand
  ports of the top packages (D-4);
- the compiler on macOS (Apple silicon), then on native Windows (T-3), with a
  Mac mini bought when that work begins (A-1);
- analysis budgets scaled by program size, each exhaustion reported by name
  (P-7);
- the in-scope dynamic features, each with the best representation the
  compiler can prove when its time comes: reading and choosing prototypes,
  realms, `Symbol.toPrimitive` and `Symbol.hasInstance`, `Proxy`, `Reflect`,
  object integrity and the descriptors. Code made from text, changing a
  prototype and sloppy mode are the only permanent boundaries
  ([boundaries](language/boundaries.md#decisions));
- narrow test262's exclusion files (`features.json`,
  `test262-exclusions.json`) to those three boundaries, so every in-scope
  feature counts in the denominator;
- node's own tests in the gate once the node lane resumes (Q-5).

## Decisions

The priorities are the user's ([log](records/notebooks/decisions-log.md#priorities-and-order)).
The JetStream subset was decided on 10-17, and decorators come last (10-15).
The work added on 10-28 names each decision's register ID; the decisions are
in the log, from [Language (10-28)](records/notebooks/decisions-log.md#language-10-28)
on. How the old plan was folded into this one is in
[the plan's history](records/notebooks/plan-history.md).
