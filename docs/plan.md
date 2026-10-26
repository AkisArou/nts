# The plan

Where nts is going, and in what order. It rests on [`decisions.md`](decisions.md)
(the user's decisions) and [`foundations/`](foundations) (the designs being
built now).

This replaces the working plan that lived outside the repository
("conformance-driven compiler development", 2026-10-15, with its "FIRST" section
of 10-22). Everything of it that still holds is below, updated, and the places
where it disagreed with the foundations work are resolved at the end.

## Where things stand (2026-10-27)

- **The tsrs switch** (tsrs replacing tsgo, in-process) is in its final full
  gate.
- **The team:**
  - MainClaude coordinates, designs and reviews from the switch's landing.
  - Codex agents implement and measure: **compiler** (core and lowering),
    **runtime** (`runtime/c`, allocation), **tsrs** (the frontend) and
    **tsrs-helper** (the adapter, measurements).
  - The JVM and Wasm lanes are paused.
- **The machine:** one shared 32 GB box. That means at most two heavy jobs at
  once, CPUs 4–5 kept for measurement, and disk floors before builds.
  [`../AGENTS.md`](../AGENTS.md) has the rules.

## The phases

| phase | what | state |
|---|---|---|
| 1 | Settle main | now |
| 2 | Foundations, native first | next; designs decided for memory and Unicode |
| 3 | Conformance-driven development | paused since 10-22; its records keep gating |
| 4 | The JVM and Wasm on the same foundations | after phase 2 |

Benchmarks run through every phase.

## Phase 1: settle main

1. **Land the tsrs switch** through its full gate.
2. **Remove what tsgo leaves outside the repository:** the `target/tsgo` binary,
   `NTS_TSGO` in landing environments and scripts, and notes that still name
   it. No compatibility leftovers.
3. **Land these docs** (`docs/foundations/`, this plan, `decisions.md`).
4. **Small fixes found on the way:**
   - documentation says plain `cargo fmt`, never `--all`, which reaches the
     vendored tsrs;
   - the gate deletes its own old test binaries after its test step, so its
     build folder stops growing to 90 GB;
   - a cargo target is cleaned whole or with `cargo clean`, never file by
     file.
5. **The agents' unlanded work:** almost all of it is already in the switch,
   rejected or unfinished (the per-agent inventories of 10-26). What is worth
   keeping moves into phase 2: the six Are We Fast Yet ports, and the held
   arena API with its first caller. Deleting the leftover branches is shared
   state, so it waits for the user's approval.

## Phase 2: foundations, native first

The designs and their build orders are in [`foundations/`](foundations). The
order:

1. **Instruments before mechanisms:**
   - the memory census;
   - the new rows (`tree-teardown`, `sort-objects`, `immutable-update`,
     `array-copying-methods`, the `case-convert` variants);
   - the six Are We Fast Yet ports;
   - the Unicode fixtures and the version pin check.
2. **Memory stages 1 and 2** (cheap counting wins; the one memory analysis,
   facts only) beside **Unicode stage 1** (case mapping).
3. **Then:** memory stage 3 (per-site regions, json-parse first), Unicode stages
   2–3, and the strings, numbers and hashing work.

### What the old plan's "FIRST" list became

| old item (10-22) | where it is now |
|---|---|
| Strings first, stages 0 and A–G | 0, A (zmij) and B (destination passing) are built. C (allocation) is [memory](foundations/memory.md) stages 1–3. D (header hash and flags) and E (SIMD copy-and-check) are pending, for a strings page. F (Wasm strings) moves to phase 4. G (parse regions) is memory stage 3, plus field ranges. |
| Closures passed as values | The two-class devirtualization is built. Field and return-value class sets, call-site splitting and typed adapters are pending (the calls study's stages 2–4). |
| Reference counting in moves and sorts | Memory stage 1. |
| Wasm type tests and array access | Phase 4. |
| Map key paths | Hash tables: the seeded hash (open), and `Map<K, number>` values stored unboxed. |
| Native indirect calls | The calls study's stages 2–4. |
| JSON as a compiler-specialized builtin | After the general causes (decision of 10-23). Typed stringify is built. Typed `JSON.parse(...) as T` and simdjson come on top of memory stage 3. |
| Finish and optimize runtime/ecmascript and runtime/web-platform | After the foundations, through the builtins provider mechanism. |
| Builtins: one mechanism to declare providers per target | The host-boundary foundation, in 12 stages. Its 11 product decisions are made. |
| tsrs replaces tsgo | Phase 1. |
| QuickJS goes entirely | `dtoa.c` is gone. `libregexp` is unused: delete it. `libunicode` goes through [Unicode](foundations/unicode.md) stages 1–3. Then `runtime/c/quickjs/` is deleted with its license and README entries. |

### Backlog noted on the way (10-24)

- `Map<K, number>` values stored unboxed (Bun 3.9x and Java 3.1x faster on
  `map-literal-keys`).
- Integer accumulators, so that `(a + b) | 0` stays in int32.
- `Array.prototype.flat` is refused.
- Intersection-typed parameters, a refusal family.
- One exit-code convention across commands; parse the command line once.
- A per-case ratchet for the TypeScript corpus.
- One hash definition in core, used by every backend, including Wasm's literal
  hashes.

## Phase 3: conformance-driven development

Paused on 10-22 so the foundations come first. test262 records keep gating, and
no new family starts. When it resumes:

**Four suites, on all four backends:**

| suite | checks | oracle |
|---|---|---|
| test262 (upstream, unedited) | JavaScript semantics | the test itself |
| ts-conformance (new, `tests/typescript/`) | TypeScript-specific run-time semantics, and the typed paths of every type-system concept and their pairings | the test itself; every case must first pass on node |
| ts-corpus (TypeScript's own tests, unedited) | compile robustness (no crash, no invalid output); the executable ones agree with node | node running TypeScript's emit |
| generated (YARPGen-style) | interactions between concepts nobody wrote by hand | node; each program prints a hash of its results |

**Representation is checked, not assumed:**

- `expect-ir` facts on cases (built);
- `nts stats` counters per program;
- one benchmark row per concept family on every backend;
- an A/B switch for each representation decision.

**Three tiers of performance checks:**

| tier | cadence |
|---|---|
| representation assertions | every landing |
| concept benchmarks (instruction counts) | the full run |
| cross-language suites | the full run |

**The machine for it:**

| piece | state |
|---|---|
| core gate per landing, wide steps in the full run | built |
| `inner.ts` | built |
| content-keyed frontend snapshot cache | built |
| full run (`tooling/census/full.ts`) | built |
| test262 runner with records on C, JVM and Wasm | built |
| LLVM test262 records | missing |
| `emit --backends`, choosing the cases a change touches (`--touching`) | partly built |
| ts-conformance suite and its oracle | not started |
| ts-corpus | not started |
| generator | not started |

When `--touching` exists, the rule "run the five test262 records before the
gate" becomes "run the inner loop on every backend before queueing".

**Order of families:**

1. wrong answers and invalid output first;
2. backend parity;
3. refusal families by reach;
4. early errors;
5. decorators last (decision of 10-15).

## Benchmarks (through every phase)

- **The six Are We Fast Yet ports** (Richards, DeltaBlue, Havlak, CD, Json,
  Storage) land in phase 2's instruments, against their own C++ and Java.
- **Then a JetStream 3.0 subset as a suite** (decided 10-17): pinned at tag
  `JetStream3.0`, unedited, with about 16 compute workloads first. GPL, LGPL
  and unlicensed workloads, DOM, `eval`, `Proxy`, Intl, Workers and the Wasm
  workloads are out. Their refusals become a ranked backlog.
- **Comparators per backend:**
  - native: C++;
  - JVM: Java;
  - Wasm: C compiled to Wasm, and AssemblyScript;
  - every backend: node and Bun.
- **Instruction counts** are the regression signal between runs; wall time is
  for the ratios. Every result is shown with its ratios, conditions and
  verdict.

## Phase 4: the JVM and Wasm

- **The JVM** resumes with a design per foundation:
  - Java's `String` and destination passing;
  - JSON's Java kernels;
  - a zmij port;
  - nts's Unicode tables (D4);
  - the paused `jvm/appended-results` work (`20c59475d`).
- **Wasm** follows its 10-25 direction ([`wasm.md`](wasm.md)): one WasmGC
  backend, browser-first, built through Binaryen. Open questions to settle by
  measurement when it resumes:
  - whose strings the JS-hosted profile reads characters from;
  - how the standalone profile gets its runtime pieces (number formatting,
    hashing, Unicode tables);
  - Wasm's literal hashes through the shared hash definition.

## Where the old plan and the foundations disagreed, and the resolution

| the old plan said | now | why |
|---|---|---|
| tsrs in stages: bump tsgo, digest-equal snapshots, switch with `NTS_FRONTEND=tsgo` kept for a cycle | one switch, no tsgo intermediate steps; tsgo deleted after it | the user, 10-23 |
| no local patches to vendored tsrs | one temporary patch for two checker crashes, removed when upstream fixes them | the user, 10-24 |
| replace `libunicode` with "our own Rust generator or ICU4X data, whichever measures faster" | our own generator (D1), with an A/B on `case-convert-greek` to honour the criterion | [unicode.md](foundations/unicode.md) |
| ICU4C only as an opt-in link, and no C++ standard library | ICU4C for locale services only, with a static C++ library in Intl programs only (D3) | byte-identical Intl answers to node |
| answer the json-parse row with the typed `JSON.parse` builtin (MainClaude, 10-23 morning) | fix the general cause first: per-site regions, and `null` placeholders in our parser (M1); the builtin comes on top | the user, 10-23 evening |
| regions as R4 placement facts over counted code | one analysis before counting (M1) | [memory.md](foundations/memory.md) |
| "declare a JSON-shaped type acyclic?" | proved, never declared (decision 12, M5) | the user, 10-23 |
| the string hash takes a per-process random seed | still the decision; main's hash is unseeded and literal hashes are fixed at compile time, so main must change | open item in the [map](foundations/README.md) |
| Wasm owns its strings in GC arrays (strings design, 10-22) | the JS-hosted profile uses the host's strings (10-25 direction); measured again when Wasm resumes | the later direction |
| five agents: MainClaude, CompilerHelper, CompilerHelper2, JVM, Wasm | MainClaude coordinates; Codex agents compiler, runtime, tsrs and tsrs-helper | the user, 10-23 and 10-27 |
| disk: clear targets before phase 4 of the old plan | disk floors before every build; targets cleaned whole; the gate prunes its own binaries | lessons of 10-23 and 10-26 |

## History

- The previous working plan was `~/.claude/plans/moonlit-crafting-toucan.md`
  (local). It is kept as history; this file replaces it.
- The 10-22 studies (strings, JSON, runtimes, builtins, calls, memory,
  objects, numbers, vendored code) and the 10-27 studies (memory, Unicode) are
  in `~/.cache/nts-scratch/` (local). Their designs are being written into
  [`foundations/`](foundations).
- [`compiler-delivery-plan.md`](compiler-delivery-plan.md) is the earlier
  delivery log (to 10-04).
