# Conformance

How nts is held to the standards it implements. Each standard has a page
saying what runs, how a case is counted, what is in scope, and where the
numbers are. These pages are for anyone reading a count, changing what a suite
runs, or landing a change the gate checks against one.

| standard | what runs | how it is counted | numbers |
|---|---|---|---|
| [test262](test262.md), for ECMA-262 | test262 at its pin: one strict variant of each ECMA-262 file, on every backend | five outcomes per case; cases under a boundary leave the in-scope denominator; the gate re-runs the recorded cases | [`results/test262/`](../../results/test262) |
| [TypeScript](typescript.md) | nts's TypeScript conformance suite, `tests/typescript/`, with node as its oracle, on every backend; and TypeScript's own compiler tests | the suite as test262 is, with nothing excluded; the compiler tests by whether each lowers, and by failure rows held at zero | [`results/typescript/`](../../results/typescript), [`results/suite/corpus.md`](../../results/suite/corpus.md) |
| [node](node.md), for `node:*` | node's own tests for each `runtime/node` module, run on node and against the compiled addon | per file: pass, fail, skip or not applicable; a module passes when no file fails; a compiled pass counts only if it measures the module | printed per run; each module's compiled passes in [`compiled-axis.floor`](../../tooling/conformance/compiled-axis.floor) |

Scope is the same for all three: what nts declines on principle is
[boundaries](../language/boundaries.md), and each page adds the scope of its
own suite.

## What every suite shares

- **Upstream tests run as upstream wrote them.** A test nts cannot pass is a
  gap to report, never a test to edit. Where a harness is replaced, only what
  the standard allows is replaced.
- **Every exclusion cites its authority,** a section of
  [boundaries](../language/boundaries.md) or of the suite's page. An excluded
  case is still run where it can be, and counted apart.
- **A count names its denominator.** A pass count over a sample, or over the
  cases a record names, is not a conformance rate, and the tools print it as a
  count.
- **A record is a ratchet.** The gate re-runs the cases a record names and
  fails on a regression. A new pass enters a record only when a full run, from
  a pin of a commit, re-records it.
- **Numbers live in `results/`,** written by the tools that measure them
  ([`results/README.md`](../../results/README.md) says which tool writes
  which file). These pages link to them and never copy them.

nts's own corpora are not standards, and they live in [`tests/`](../../tests):
programs compared with node, refusals, recorded outcomes and memory cases.

## Decisions

- Upstream code (node's tests, test262, React) is kept as upstream wrote it,
  and the gap is reported ([log](../records/notebooks/decisions-log.md#team-and-process)).
- test262 runs on every built backend, the JVM included; Wasm rejoins when
  its Binaryen backend exists.
- Where test262 and node disagree, test262 decides the language, and node
  what the specification leaves to the host
  ([language](../language/README.md#decisions); L23, 10-28,
  [log](../records/notebooks/decisions-log.md#language-10-28)).
- Every conformance record is a per-case ratchet: each case may only move
  toward passing, and a record changes only through a reviewed `results:`
  commit (Q-4; 10-28,
  [log](../records/notebooks/decisions-log.md#performance-and-process-10-28)).
  Not built.
- Q-6 is the combination of
  [`fuzz-expressions.mjs`](../../tooling/conformance/fuzz-expressions.mjs) and
  [`fuzz-statements.mjs`](../../tooling/conformance/fuzz-statements.mjs), using
  [`fuzz-runtime.mjs`](../../tooling/conformance/fuzz-runtime.mjs) to compare
  generated programs with node through value assertions in compiled C
  executables. The `divergence` gate step runs both at a fixed seed. These
  seeded fuzzers cover their expression grammar and statement templates,
  scalar oracle results, and C; they do not exercise LLVM, JVM or Wasm.
  Refusals and unusable oracle values leave gaps, and batch summaries do not
  establish how many value assertions ran. Failure isolation stops at an
  expression or a statement template, without reducing its syntax. The
  complementary [`sweep.mjs`](../../tooling/sweep/sweep.mjs) generates a fixed
  cross-product of value kinds and operations and compares its exported
  functions with node through the differential harness on C and the JVM.
  Its deterministic enumeration is separate from Q-6's seeded program
  fuzzing. Runtime comparisons and `differential-*` API-input generators are
  also separate instruments
  ([coverage inventory and gaps](../records/q6-generator-inventory.md);
  [log](../records/notebooks/decisions-log.md#q-6-names-the-compiled-program-generators-11-25)).
