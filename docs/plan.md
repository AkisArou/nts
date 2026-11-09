# The plan

What nts builds, and in what order: the priorities, and the streams of work
in the order they are taken. Each task is a GitHub issue under its stream's
parent issue, its card in the issue and its state on it
([workflow](workflow.md#tasks)); chores are on the local board. The designs
the tasks build are in [`foundations/`](foundations), and the questions still
open are in [`open-questions.md`](open-questions.md).

## Priorities

- **Foundations and correctness in parallel.** The foundations (the memory
  analysis, bounds-check placement, typed containers, strings, numbers, the
  builtins mechanism) are the main line, until each reaches its designed
  performance. Bugs are fixed beside them: a silent wrong answer before a
  refusal, which is safe, and both in the order of how much real code they
  affect. The TypeScript suite's families are measured as test262 is: their
  failures are recorded and flip as fixes land, and they do not set the order
  of work ([log](records/notebooks/decisions-log.md#team-and-priorities-11-01)).
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
- **Every row is held to [the bar](README.md#the-bar),** against node, Bun's
  JIT and ahead-of-time compiler, and ScriptC.

## Now

**The workflow settles before development resumes:** the records, the memory
admission and signalbox running nts (the Tooling and Signalbox streams).
Development starts on the user's word.

Branches the count names from here, besides each open issue's own:

- Chromium, paused by the user (`chromium/counter-tree-profile`,
  [#589](https://github.com/AkisArou/nts/issues/589)), its trees kept with
  it: `~/Projects/nts-lanes/chromium`,
  `~/.cache/nts-chromium-checkpoint1/context-control` and
  `~/.cache/nts-chromium-checkpoint1/scoped-harness-61e0020e9`.

## Streams

In the order they are taken. A stream's tasks are its parent issue's
sub-issues; their order is their dependencies, then the ranking.

| stream | what | when | parent issue |
|---|---|---|---|
| Correctness | wrong answers first, then aborts and failed builds, then refusals by reach | beside the foundations | [#467](https://github.com/AkisArou/nts/issues/467) |
| Foundations, native first (phase 2) | each foundation at its designed performance | the main line | [#468](https://github.com/AkisArou/nts/issues/468) |
| Benchmarks and the web platform | the suites, the comparators and the web floor | through every phase | [#471](https://github.com/AkisArou/nts/issues/471) |
| Tooling | the gate, the landing and full checks, the records, the memory admission | now | [#472](https://github.com/AkisArou/nts/issues/472) |
| Signalbox runs nts | the agents per task and the dashboard | now | [#475](https://github.com/AkisArou/nts/issues/475) |
| Node | `runtime/node` on Node 26 | beside the foundations | [#473](https://github.com/AkisArou/nts/issues/473) |
| Conformance-driven development (phase 3) | the four suites on every backend | paused; its records keep gating | [#469](https://github.com/AkisArou/nts/issues/469) |
| The JVM and Wasm (phase 4) | the same foundations on the JVM and WasmGC | after phase 2 | [#470](https://github.com/AkisArou/nts/issues/470) |
| Chromium | the Chromium app | paused by the user | [#474](https://github.com/AkisArou/nts/issues/474) |

### Foundations, in order

1. **Instruments before mechanisms:** the memory census (M-1) and the memory
   rows; the Are We Fast Yet suite of fourteen against node, Bun, C++ and
   Java; the Computer Language Benchmarks Game, Octane and ARES-6; startup,
   size and peak-RSS rows (P-2); a differential program fuzzer (Q-6).
2. **Memory stages 1 and 2** ([memory](foundations/memory.md)), beside
   **Unicode stage 1** ([unicode](foundations/unicode.md)).
3. **Typed containers:** `Map` and `Set` stored by the proven layout of their
   keys and values ([objects](foundations/objects.md)).
4. **Then** memory stage 3, Unicode stages 2–3, strings stages D and E
   ([strings](foundations/strings.md)), numbers
   ([numbers](foundations/numbers.md)) and the keyed hash
   ([hashing](foundations/hashing.md)).
5. **The builtins mechanism** ([builtins](foundations/builtins.md)), with
   WinterTC's Minimum Common Web API as the web floor on native and the JVM.
6. **The dependency policy** (D-1), written as a foundations page.
7. **Licensing:** `nts build` writes the notices file for the third-party code
   a program links.
8. **Bounds-check placement** ([objects](foundations/objects.md#arrays)).
9. **Calling C** ([calling C](targets/calling-c.md)), in parallel with the
   rest: the vocabulary, the binder, the existing bindings, then the rows.

### Phase 3, when it resumes

Four suites on every backend (test262, the TypeScript conformance suite,
TypeScript's own tests, generated programs). Representation is checked, not
assumed, and performance is checked in three tiers: representation assertions
at every landing, concept benchmarks by instruction counts and cross-language
suites in the full run. Families go in order: wrong answers and invalid
output, backend parity, refusal families by reach, early errors, decorators
last. The language work decided for this phase is under its parent issue.

### Phase 4

The JVM resumes with a design per foundation. Wasm is one WasmGC backend,
browser-first, built through Binaryen ([targets](targets/wasm.md)). Both rest
on [their foundations](foundations/jvm-and-wasm.md).

## Benchmarks

- **Are We Fast Yet,** all fourteen, against their own C++ and Java
  references.
- **Then a JetStream 3.0 subset, as a suite:**
  - pinned at the tag `JetStream3.0` and unedited, with about 16 compute
    workloads first;
  - out of it: GPL, LGPL and unlicensed workloads, the DOM, `eval`, `Proxy`,
    Intl, Workers and the Wasm workloads;
  - their refusals become a ranked backlog;
  - the parked ports are the pull requests #69 to #74, and #118 after its
    licence check.
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

The Bun and ScriptC studies' findings are in
[the audit](records/notebooks/aot-studies-audit.md); their correctness items
and experiments are issues.

## Decisions

The priorities are the user's ([log](records/notebooks/decisions-log.md#priorities-and-order)).
The JetStream subset was decided on 10-17, and decorators come last (10-15).
The work added on 10-28 names each decision's register ID; the decisions are
in the log, from [Language (10-28)](records/notebooks/decisions-log.md#language-10-28)
on. How the old plan was folded into this one is in
[the plan's history](records/notebooks/plan-history.md).

- **Tasks are GitHub issues** (11-09): this page keeps the priorities and the
  order of the streams; each task is an issue under its stream's parent
  issue, chores are on the local board, and a task's branch names its issue
  ([log](records/notebooks/decisions-log.md#tasks-are-github-issues-11-09)).
