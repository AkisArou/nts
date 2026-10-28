# The plan

What is being built, in what order, and what each step waits on. This is the
one page that changes as work goes; the designs it builds are in
[`foundations/`](foundations), and the questions still open are in
[`open-questions.md`](open-questions.md).

## Priorities

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

- **The team:** the coordinator decides, designs and reviews. Agents implement
  and measure:
  - **compiler:** the core and lowering;
  - **runtime:** `runtime/c`, allocation and benchmarks;
  - **runtime2:** the JVM and the gate's telemetry;
  - **tsrs:** the frontend and the gate tooling;
  - **helper2:** landing the cloud agents' pull requests, fixtures, the
    TypeScript runtimes and the Are We Fast Yet ports;
  - **cloud agents** (ChatGPT, through pull requests): the web platform's
    conformance, the Web Cryptography API, WebSocket and EventSource, and
    benchmark ports ([cloud-agents](contributing/cloud-agents.md)).

  The JVM is maintained while its new work waits for phase 4; the Wasm backend
  is being rebuilt on Binaryen IR.
- **The machine:** one shared 32 GB box. At most two heavy jobs run at once,
  CPUs 4–5 are kept for measurement, and every build checks the disk floor
  first ([`../AGENTS.md`](../AGENTS.md)).

## The phases

| phase | what | state |
|---|---|---|
| 1 | Settle `main` | finishing |
| 2 | Foundations, native first | next; memory and Unicode designs decided |
| 3 | Conformance-driven development | paused; its records keep gating |
| 4 | The JVM and Wasm on the same foundations | after phase 2 |

Benchmarks run through every phase.

## Phase 1: settle main

1. **The tsrs switch.** *Done.*
2. **What tsgo left behind.** The binary is gone; `NTS_TSGO` is still read by
   two JVM test files (`compiler/codegen/jvm/tests/intrinsics.rs`,
   `refusals.rs`).
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
     against a threshold set from repeated runs of one binary (*done*); the
     reference-counting build gets a row of its own next;
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
      `process.stdout.write` and the node `console` (*landing*);
    - a project that is not `strict` is refused, naming the flags that are
      off, all nine, as NTS1006 (L8, *landing*);
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
   facts only), beside **Unicode stage 1** (case mapping). Stage 1 so far:
   release by type, the count-free sort and proved-integer `Math.min` and
   `Math.max` are on `main`; typed collector visitors are next
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
  - every backend: node and Bun;
  - each at a pinned version, node, Bun, the JDK and clang included (P-4).
- **Instruction counts** are the regression signal between runs; wall time is
  for the ratios. Every result is shown with its ratios, the machine's
  conditions and the verdict.

## Backlog

Noted, not scheduled:
- `Map<K, number>` values stored unboxed (Bun 3.9× and Java 3.1× faster on
  `map-literal-keys`);
- integer accumulators, so that `(a + b) | 0` stays in int32: needs
  container content facts to prove the addend (the guarded form was measured
  and parked on its compile cost; the row it seemed to lose lies inside that
  row's layout range);
- argument ranges through recursion: an index computed as `(3 - from) - to`
  across recursive calls widens to an unbounded range with `NaN`, so the
  recursive methods of `awfy-towers` keep double indices and check them twice;
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
- the runtime's check on every entry from a thread it does not own, on every
  host (C-3, I-3; record 0018);
- promises across boundaries: a deferred plus a threadsafe function for
  N-API, and `nts_checkpoint` documented for C embedders (I-4);
- one nts instance per process, a second refused clearly (I-7);
- ResourceFlow with its enforcement, then `bind-c` over whole headers (I-5,
  B-1);
- host errors as catchable `Error`s carrying the host value, after research
  on unwinding through C frames (I-2);
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
- node's own tests in the gate once the node lane resumes (Q-5).

## Decisions

The priorities are the user's ([log](records/notebooks/decisions-log.md#priorities-and-order)).
The JetStream subset was decided on 10-17, and decorators come last (10-15).
The work added on 10-28 names each decision's register ID; the decisions are
in the log, from [Language (10-28)](records/notebooks/decisions-log.md#language-10-28)
on. How the old plan was folded into this one is in
[the plan's history](records/notebooks/plan-history.md).
