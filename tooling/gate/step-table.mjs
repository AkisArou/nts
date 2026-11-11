// The gate's step table: what each step of tooling/gate/all.sh can use and
// needs. run.mjs schedules from it; the landing check estimates from it
// (tooling/landing/selection.ts). A row is policy for every step it names, so
// a change here owes what a change to the runner owes.
//
// One row per `step` line in all.sh; run.mjs's `checkTable` fails the
// run if the two disagree in either direction.
//
//   slots  workers the step can use; it gets NTS_GATE_JOBS = what it was given
//          (an elastic step gets all of them, and they wait for tokens)
//   min    fewest slots it may start with (default: half of slots)
//   elastic  its workers take a token per process (token.sh, tokens.mjs), so
//          it holds a share of the budget that moves with the work instead of
//          a grant fixed when it starts (see "Tokens")
//   fe     true when its workers start frontends (counted against FRONTENDS)
//   nts    true when it drives the compiler: needs the binary and the frontend
//   needs  steps that must PASS first (only when they are requested too)
//   after  steps that must finish first, whatever their verdict
//   lock   an exclusive resource (cargo's build-directory lock)
//   host   what the machine must have, named when the step SKIPs
//   favoured  runs at the runner's own priority; every other step at nice +5
//   treeOnly  true when it reads only the tree, builds and runs nothing, and
//          takes seconds: one never measured is costed at seconds
//   capabilities  environment requirements, read before a landing/full run takes the lock
//   bound  seconds the step may run before it is stopped and held, for a step
//          whose recorded cost cannot derive one (step-bound.ts): no committed
//          baseline, or a cost that is what its build cache lacks
//   doc    what it proves, for the summary's reader
//
// No row says how much memory its step needs: what the run reserves for a
// step is what the step was measured to hold in its target's scheduling
// history (step-scheduling.ts), per token for an elastic step.
// ---------------------------------------------------------------------------
import { statedBoundProblem } from "./step-bound.ts";

export const STEPS = [
  // Its history is the last build's, which a warm cache makes seconds; a cold
  // release build of the workspace took about forty minutes beside a gate.
  { name: "build", slots: 8, min: 4, lock: "cargo", bound: 7200, doc: "release binaries build" },
  // Its own target directory (see stepEnv), so it neither waits for nor blocks
  // `build` and `tests` on cargo's build-directory lock.
  { name: "clippy", slots: 6, min: 4, lock: "clippy", doc: "lint clean" },
  { name: "format", slots: 1, treeOnly: true, doc: "runtime/c is clang-formatted" },
  { name: "rustfmt", slots: 1, treeOnly: true, doc: "the Rust tree is cargo-fmt formatted" },
  { name: "reformat", slots: 1, treeOnly: true, doc: "no whitespace-only diffs" },
  { name: "records", slots: 1, treeOnly: true, doc: "record numbers unique" },
  { name: "old-paths", slots: 1, treeOnly: true, doc: "nothing sits or points where the corpora used to be" },
  { name: "audit", slots: 1, treeOnly: true, doc: "classification reasons, authorities and suite entries" },
  { name: "doctests", slots: 4, min: 1, lock: "cargo", after: ["build"], bound: 3600, doc: "touched crates' doc examples compile and pass" },
  { name: "test262", slots: 1, after: ["build"], doc: "test262 pin, inventory, features audit" },
  // The conformance steps are elastic: the resident pool starts all its
  // workers, and each case holds one token from dispatch to answer
  // (worker-pool.ts), so a step's share follows its work instead of the
  // grant it happened to start with.
  { name: "test262-cases", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "test/language rows reproduce" },
  { name: "test262-builtins-cases", elastic: true, slots: 4, min: 2, nts: true, fe: true, doc: "test/built-ins rows reproduce" },
  { name: "test262-rest-cases", elastic: true, slots: 4, min: 2, nts: true, fe: true, doc: "annexB, staging, harness rows reproduce" },
  // The five records on one backend each (all.sh's test262_backend): one
  // frontend per case as on C, plus the backend's own run -- a JVM per case
  // under its fixed -Xmx.
  { name: "test262-jvm", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every recorded test262 row reproduces on the JVM",
    capabilities: ["jvm"],
  },
  { name: "test262-llvm", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every recorded test262 row reproduces on LLVM" },
  // Every test262 directory run whole on one backend (all.sh's test262_census),
  // held to its records, listing each case that runs now for the full check.
  { name: "test262-census-c", bound: 3600, elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every test262 directory, whole, on C: recorded rows hold, and what runs now is listed" },
  { name: "test262-census-llvm", bound: 3600, elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every test262 directory, whole, on LLVM: recorded rows hold, and what runs now is listed" },
  { name: "test262-census-jvm", bound: 3600, elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every test262 directory, whole, on the JVM: recorded rows hold, and what runs now is listed",
    capabilities: ["jvm"],
  },
  // The TypeScript records on one backend each (all.sh's typescript_backend).
  { name: "typescript-oracles", bound: 3600, elastic: true, slots: 8, min: 2, fe: true, doc: "one authenticated Node answer per TypeScript case, shared by every backend" },
  { name: "typescript-c", needs: ["typescript-oracles"], elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every recorded TypeScript conformance case reproduces on C" },
  { name: "typescript-llvm", needs: ["typescript-oracles"], elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every recorded TypeScript conformance case reproduces on LLVM" },
  { name: "typescript-jvm", needs: ["typescript-oracles"], elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every recorded TypeScript conformance case reproduces on the JVM",
    capabilities: ["jvm"],
  },
  { name: "outcomes", needs: ["program-oracles"], slots: 1, nts: true, fe: true, doc: "pinned defects still do what they did" },
  { name: "expect-ir", slots: 1, nts: true, fe: true, doc: "representation facts in the corpora hold" },
  { name: "integrity", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "listings self-consistent over examples, blockers, outcomes" },
  // Reads integrity-runtime's `hir --prepared` listings when both are in the
  // run (NTS_DEFINITIONS_FROM), rather than lowering the corpus again.
  { name: "definitions", elastic: true, slots: 4, min: 2, nts: true, fe: true, after: ["integrity-runtime"], doc: "no runtime module emits fewer functions" },
  // Reads the CPU time integrity-runtime measured on that same lowering
  // (NTS_COMPILE_TIMES_FROM); lowers the modules itself when it runs alone.
  { name: "compile-time", elastic: true, slots: 8, min: 2, nts: true, fe: true, after: ["integrity-runtime"], doc: "NoGC preparation stays within its calibrated instruction budget" },
  // No committed baseline: one measured run took 1,352 CPU seconds over 18 minutes.
  { name: "compile-time-rc", elastic: true, slots: 4, min: 2, nts: true, fe: true, after: ["build"], bound: 3600, doc: "RC preparation stays within its calibrated instruction budget" },
  { name: "integrity-runtime", elastic: true, slots: 12, min: 4, nts: true, fe: true, doc: "listing rules over the runtime corpus" },
  { name: "assembles", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "runtime LLVM IR assembles" },
  { name: "c-compiles", elastic: true, slots: 8, min: 2, nts: true, fe: true, after: ["profile"], doc: "every runtime program's emitted C compiles" },
  { name: "types", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "snapshot type tables consistent" },
  { name: "jvm-verifies", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "runtime and outcomes JVM output verifies",
    capabilities: ["jvm"],
  },
  // Its runner (tooling-runner.ts) starts as many test files at once as
  // node:test allows and reads no NTS_GATE_JOBS, so its slots say how much of
  // the machine it keeps busy: in a landing on 2026-11-10, its slice (the
  // units its tests start included) used 1,755 CPU s over 116 s, 15 cores. Its
  // files averaged 18 at once, but a file spends part of its wall waiting on
  // what it started, and a slot is a share of a budget sized in cores.
  { name: "tooling-types", slots: 1, treeOnly: true, doc: "every tooling module is strictly checked; legacy diagnostics may only fall" },
  { name: "test-host", slots: 1, treeOnly: true, doc: "test dependencies obey host observation ownership" },
  { name: "tooling", slots: 15, doc: "the gate's own tools pass their tests", capabilities: ["jvm", "android"] },
  { name: "primitives", slots: 1, treeOnly: true, doc: "docs/primitives.md names exist" },
  { name: "tests", slots: 8, min: 4, lock: "cargo", after: ["build"], doc: "cargo test --workspace",
    capabilities: ["jvm"],
  },
  { name: "corpus", slots: 8, min: 4, nts: true, fe: true, doc: "invalid HIR 0, uncompilable C 0, unverifiable class 0",
    capabilities: ["jvm"],
  },
  // Each case's compile holds a token, under its own 6 GiB kernel cap, the one
  // its rows were recorded under (build-records.ts): as wide as the other
  // compile-per-case steps.
  { name: "benches", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "bench cases emit and compile on C, LLVM, JVM" },
  { name: "example-refusals", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "per-example refusal counts match the table" },
  { name: "config", slots: 1, treeOnly: true, doc: "nts.config.ts files coherent" },
  { name: "react-sources", slots: 1, doc: "vendored React sources match the manifest" },
  // Measured offline inventory: 0.03 s wall, 64 MiB peak RSS (2026-10-24).
  { name: "licenses", slots: 1, treeOnly: true, doc: "compiler dependency license texts match the locked closure" },
  // Native frontend capture checks; they share the ordinary cargo target and lock.
  { name: "frontend-tsrs", slots: 4, min: 4, lock: "cargo", doc: "native source inventory, attributions, Clippy and adapter tests pass" },
  { name: "profile", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "runtime/node emits without a panic, under the refusal ceiling" },
  { name: "sweep", slots: 1, nts: true, fe: true, doc: "the value-kind cross-product agrees on C" },
  { name: "llvm", needs: ["program-oracles"], elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every example agrees with node on LLVM" },
  { name: "llvm-rc", needs: ["program-oracles"], elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every example agrees with node on LLVM under RC" },
  { name: "jvm", needs: ["program-oracles"], elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every example agrees with node on the JVM",
    capabilities: ["jvm"],
  },
  { name: "dex", elastic: true, slots: 8, min: 2, nts: true, fe: true, host: "an Android SDK with build-tools", doc: "d8 accepts emitted classes",
    capabilities: ["android", "jvm"],
  },
  { name: "on-device", slots: 1, nts: true, fe: true, host: "an Android device on adb", doc: "bench cases agree on java and dalvikvm",
    capabilities: ["android", "jvm"],
  },
  { name: "bench-agree", needs: ["program-oracles"], elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "bench cases agree with node",
    capabilities: ["jvm"],
  },
  { name: "program-oracles", bound: 3600, elastic: true, slots: 2, min: 1, fe: true, doc: "one authenticated Node answer per program; bounded SDK workers drain before native execution" },
  { name: "examples", needs: ["program-oracles"], elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every example agrees with node on C" },
  { name: "rc", needs: ["program-oracles"], elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "every example agrees under RC, no leak" },
  { name: "memory", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "RC: no leak, same answer, counts at floors" },
  // After `profile` when both run: build.sh reuses its `emit-c --napi` output
  // (NTS_ADDON_EMITTED) when profile emitted the module cleanly with this binary.
  { name: "addons", elastic: true, slots: 8, min: 2, nts: true, fe: true, after: ["profile"], doc: "node modules build, load and publish" },
  { name: "blockers", elastic: true, slots: 8, min: 2, nts: true, fe: true, doc: "blocker fixtures still refuse as they say",
    capabilities: ["jvm"],
  },
  { name: "divergence", slots: 1, nts: true, fe: true, after: ["addons"], doc: "node divergence instruments" },
  // Favoured: every other step runs at `nice +5` beside it. Two of its projects
  // race a timer against a callback, and contention is what makes that race
  // lose (see the comment above its step line in all.sh); it ran alone, last,
  // for that reason. Lanes inside it: apple VM, windows VM, and one local lane
  // per worker, taking projects from one queue, longest first.
  //
  // Six local lanes, not twelve: a GTK project's `nts build` binds its GIR
  // closure one thread per namespace, each a clang run, so one token is a
  // burst of ten or more cores. At twelve lanes the step's CPU time was 13,429
  // s against 5,137 at three (2026-10-07) -- the same work, inflated by
  // contention -- and it ended the run.
  { name: "interop", elastic: true, slots: 6, min: 3, nts: true, fe: true, favoured: true, doc: "interop projects build and run" },
];

/**
 * What is wrong with the table, or null: a stated bound that is not a positive
 * number of seconds, a step that depends on no step, or steps that wait for one
 * another. The runner waits for a step's `needs` and `after` while they are
 * requested and unfinished, so a cycle among them would wait for ever; it
 * refuses such a table before anything runs.
 */
export function stepTableProblem(steps = STEPS) {
  for (const s of steps) { const problem = statedBoundProblem(s); if (problem) return problem; }
  const names = new Set(steps.map((s) => s.name));
  const deps = new Map(steps.map((s) => [s.name, [...(s.needs ?? []), ...(s.after ?? [])]]));
  for (const [name, on] of deps) for (const d of on) if (!names.has(d)) return `${name} depends on ${d}, which is not a step`;
  const done = new Set(), path = [];
  const visit = (name) => {
    if (done.has(name)) return null;
    const at = path.indexOf(name);
    if (at >= 0) return [...path.slice(at), name];
    path.push(name);
    for (const d of deps.get(name)) { const cycle = visit(d); if (cycle) return cycle; }
    path.pop();
    done.add(name);
    return null;
  };
  for (const name of deps.keys()) {
    const cycle = visit(name);
    if (cycle) return `steps wait for one another: ${cycle.join(" -> ")}`;
  }
  return null;
}
