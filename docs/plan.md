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
  - **helper:** fixtures, documentation, the TypeScript runtimes and the
    Are We Fast Yet ports.

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
   - every step runs in one canonical environment, whoever launches the gate;
   - the compile-time tripwire counts every compiler thread from the start,
     against a threshold set from repeated runs of one binary.
5. **The fast landing model** (approved):
   1. a change owes only the checks it can affect, so docs, records and
      comments land in seconds, with no train (*done*: the fast lane);
   2. the gate's waiting is fixed, its results are cached by their inputs, and
      only the cases a change can affect run, for a full gate near 10
      minutes. *Waiting fixed:* frontend capacity follows the CPU slots,
      reservations only for steps that can fit, memory budgets calibrated from
      measured peaks, and `blockers` runs in parallel. *Caching:* keyed on
      artifact bytes; the JVM verifier's results are reused, and the other
      kinds stay in shadow mode until their results are proved identical.
      Next: one capture per project per run, shared by every step;
   3. then code lands after a 5–10 minute check, while a verifier gates `main`
      behind it, bisects a red and reverts the culprit automatically. Changes
      to the gate itself stay strict. *The ledger and the shadow verifier are
      on `main`;* optimistic landing waits for three shadow batches that agree
      with their trains, then for the holds, bisection and brake.
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
      checks never depends on the machine's load;
    - a wall-clock deadline decides no result anywhere in the gate.
11. **The silent wrong answers found on the way,** in this order (a store
    that would close a cycle now keeps a counted root, so a closure that
    captures `this` no longer leaks: *done*):
    - an optional callable property in a structural type (the node stdio
      setup), then one writer per stream for `console.log`,
      `process.stdout.write` and the node `console`;
    - a `declare` field with no visible writer is refused, not read as 0;
    - decorators refused until implemented;
    - a throw through any indirect call is catchable (L15), so a failed
      check of an erased value is always a catchable `TypeError` (L6);
    - the web-platform classes keep their functional setup out of the
      reflective setup that nts defers;
    - any refusal fails `nts build`, with `--partial` for experiments (L20),
      so a refused program never runs with parts cut;
    - reads that JavaScript answers with `undefined` give `undefined`:
      holes, uninitialized fields, a `var` read before its assignment, reads
      past the end (L4, X1).

## Phase 2: foundations, native first

The designs and their build orders are in [`foundations/`](foundations).

1. **Instruments before mechanisms:**
   - the memory census;
   - the memory rows: `tree-teardown`, `sort-objects`, `release-acyclic`,
     `immutable-update`, `array-copying-methods`, `cyclic-churn`;
   - the six remaining Are We Fast Yet ports: Richards, DeltaBlue, Havlak, CD,
     Json and Storage. With the eight already on `main`, that is the whole
     suite of fourteen, against node, Bun, C++ and Java. They wait on three
     compiler gaps, recorded as fixtures: a nullable generic array property
     (four ports), Richards' module-scope sentinel, and Storage's recursive
     array return;
   - the Unicode rows (`case-convert-latin1`, `-greek`, `-cjk`,
     `-unchanged`), the new-letter fixtures and the version-pin check (*done*).
2. **Memory stages 1 and 2** (cheap counting wins; the one placement analysis,
   facts only), beside **Unicode stage 1** (case mapping). Stage 1 so far:
   release by type, the count-free sort and proved-integer `Math.min` and
   `Math.max` are on `main`; typed collector visitors are next
   ([results](../results)).
3. **Then:** memory stage 3 (per-site regions, json-parse first), Unicode
   stages 2–3, the strings stages D and E, numbers, and the keyed hash.
4. **The builtins mechanism** ([builtins](foundations/builtins.md)), once
   approved, from its stage 1. The clock and randomness come with stage 6.

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
| the program generator | not started |

When `--touching` exists, the rule "run the five test262 records before the
gate" becomes "run the inner loop on every backend before queueing".

**The order of families:**
1. wrong answers and invalid output;
2. backend parity;
3. refusal families, by reach;
4. early errors;
5. decorators last.

## Phase 4: the JVM and Wasm

Both rest on [their foundations](foundations/jvm-and-wasm.md), whose open
proposals wait on research.

- **The JVM** resumes with a design per foundation:
  - Java's `String` with destination passing;
  - JSON's Java kernels;
  - a zmij port;
  - nts's Unicode tables (D4);
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
  - every backend: node and Bun.
- **Instruction counts** are the regression signal between runs; wall time is
  for the ratios. Every result is shown with its ratios, the machine's
  conditions and the verdict.

## Backlog

Noted, not scheduled:
- `Map<K, number>` values stored unboxed (Bun 3.9× and Java 3.1× faster on
  `map-literal-keys`);
- integer accumulators, so that `(a + b) | 0` stays in int32;
- argument ranges through recursion: an index computed as `(3 - from) - to`
  across recursive calls widens to an unbounded range with `NaN`, so the
  recursive methods of `awfy-towers` keep double indices and check them twice;
- `Array.prototype.flat`;
- intersection-typed parameters, a refusal family;
- one exit-code convention across commands, and the command line parsed once;
- a per-case ratchet for the TypeScript corpus;
- one hash definition in core, used by every backend, including Wasm's literal
  hashes.

## Decisions

The priorities are the user's ([log](records/notebooks/decisions-log.md#priorities-and-order)).
The JetStream subset was decided on 10-17, and decorators come last (10-15).
How the old plan was folded into this one is in
[the plan's history](records/notebooks/plan-history.md).
