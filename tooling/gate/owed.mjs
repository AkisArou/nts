// Which checks does this change owe? Takes the change, not the author's
// reading of it, and prints the checklist.
//
//   node tooling/gate/owed.mjs                  uncommitted and untracked changes
//   node tooling/gate/owed.mjs --since <rev>    everything since <rev>, plus uncommitted
//   node tooling/gate/owed.mjs --commit <rev>   one commit's changes
//   node tooling/gate/owed.mjs --run            also run the owed gate steps
//   node tooling/gate/owed.mjs --self-test
//
// # Why
//
// On 2026-09-27 several of the compiler lane's commits were corrections of
// the ones before, and **none needed a new measurement**. Each was caught by
// a check that already existed and was not run:
//
//   - an example that aborts on the JVM, shipped after running it on C only;
//   - a backend check landed as an error against written advice, red for twelve
//     hours on one example;
//   - a name added to build-floor.sh's BLOCKED list, whose never-run loop then
//     built into the shared addon directory and turned `addons` red for every
//     lane.
//
// The rules were obvious in hindsight and none was in front of the author at
// the moment. A list of rules is read by nobody, so this takes the change as
// its input: the paths `git` says were touched, and whether they are new.
//
// # Two kinds of arm
//
// **Gate steps**, by the name `all.sh` gives them. `--run` runs exactly those,
// in one `NTS_GATE_STEPS=... sh tooling/gate/all.sh` in the tree, so what runs
// is the gate's own command and not one resembling it, and a misspelt name
// fails there rather than selecting nothing. `build` goes first: most steps
// drive this tree's `target/release/nts`. The environment passes through, and
// a worktree's missing inputs are the gate's to name, not this script's: a
// fresh one stops at "no frontend at <tree>/target/tsgo", and `NTS_TSGO=` the
// main tree's, as `pinned.sh` passes it, is the answer.
//
// **Everything else** is printed and left to the author: a comparison of two
// binaries, a sabotage, an announcement. The gate is a floor, not a
// comparison, so what it cannot say is exactly this list. `<before>` is a
// clean build of the base the change sits on and `<after>` a clean build with
// it -- never `target/release/nts`, which is whichever session linked last.

import { execFileSync, spawnSync } from "node:child_process";

/**
 * The tree whose change is asked about: the one the command is run from, not
 * the one this script lives in. "The repo" is two things here -- the rules
 * travel with the script, the change belongs to the worktree you stand in --
 * and every lane works in a worktree. Resolving it from the script's path
 * answered, confidently, about the shared checkout's uncommitted files. The
 * `--commit` mode reads history and could not show it.
 */
const TREE = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/**
 * What a change owes, as data. `when` sees one changed path and whether it is
 * new; `steps` are gate steps and `arms` what the gate cannot do, each shown
 * once however many paths matched.
 */
export const RULES = [
  {
    name: "a new example",
    when: (p, added) => added && /^examples\/[^/]+\/tsconfig\.json$/.test(p),
    why: "an example is an input to every backend step and must agree on each; one that passes before the change as well measured nothing",
    steps: ["examples", "llvm", "llvm-rc", "jvm", "rc", "integrity"],
    arms: [
      "node tooling/differential/agree.mjs <before> <after> --only=<example>   # must not read `unchanged` if it guards the change",
      "commit it before a pinned gate run: a worktree gate cannot see an uncommitted example",
    ],
  },
  {
    name: "an example changed",
    when: (p, added) => !added && /^examples\/[^/]+\//.test(p),
    why: "the same backend steps read it",
    steps: ["examples", "llvm", "llvm-rc", "jvm", "rc"],
    arms: [],
  },
  {
    name: "lowering",
    when: (p) => /^compiler\/core\//.test(p),
    why: "a lowering change moves refusals, definitions and answers; each is a different instrument",
    steps: ["examples", "llvm", "llvm-rc", "jvm", "rc", "outcomes", "integrity", "integrity-runtime", "definitions"],
    arms: [
      "node tooling/differential/agree.mjs <before> <after>   # and NTS_BACKEND=llvm, NTS_BACKEND=jvm, NTS_RC=1",
      "node tooling/conformance/refusal-diff.mjs <before> <after>   # 0 moves is not no effect",
      "a full test262 census against a baseline if it should make programs compile (--recorded cannot see a gain)",
    ],
  },
  {
    name: "the C backend",
    when: (p) => /^compiler\/codegen\/c\//.test(p),
    why: "the differential on that backend, under both memory providers, and emitted C byte-identical across the cache",
    steps: ["examples", "rc", "outcomes", "snapshot-cache"],
    arms: ["node tooling/differential/agree.mjs <before> <after>; NTS_RC=1 ..."],
  },
  {
    name: "the LLVM backend",
    when: (p) => /^compiler\/codegen\/llvm\//.test(p),
    why: "the differential only reaches examples; the runtime's IR is only ever assembled by `assembles`",
    steps: ["llvm", "llvm-rc", "assembles"],
    arms: ["NTS_BACKEND=llvm node tooling/differential/agree.mjs <before> <after>; NTS_RC=1 ..."],
  },
  {
    name: "the JVM backend",
    when: (p) => /^compiler\/codegen\/jvm\//.test(p),
    why: "the JVM verifier sees type confusions C and LLVM agree on by luck",
    steps: ["jvm", "dex"],
    arms: ["NTS_BACKEND=jvm node tooling/differential/agree.mjs <before> <after>"],
  },
  {
    name: "the frontend or the snapshot schema",
    when: (p) => /^compiler\/(frontend-ts|semantic-schema)\//.test(p),
    why: "a schema field bumps SCHEMA_VERSION; a cache identity is a claim nothing else cross-checks",
    steps: ["snapshot-cache", "examples"],
    arms: ["bump SCHEMA_VERSION if a semantic-schema struct changed"],
  },
  {
    name: "a runtime helper",
    when: (p) => /^runtime\/c\/nts_runtime\.h$/.test(p),
    why: "a new nts_* helper owes four cross-check tables and two core tests (all in `tests`), and `bench-agree` builds every backend",
    steps: ["tests", "bench-agree"],
    arms: [
      "the tables `tests` reads: nts-core runtime_signatures, nts-codegen-llvm signatures, nts-codegen-c ERASES_CLASS, nts-codegen-jvm REFUSED_FLOOR; nts-core's sorted table",
    ],
  },
  {
    name: "the C runtime",
    when: (p) => /^runtime\/c\//.test(p),
    why: "runtime/c is include_str!-ed into the compiler, and the gate formats it",
    steps: ["format", "examples", "rc", "llvm", "assembles"],
    arms: ["node tooling/differential/agree.mjs <before> <after>; NTS_RC=1 ...; NTS_BACKEND=llvm ..."],
  },
  {
    name: "a runtime module",
    when: (p) => /^runtime\/(node|web-platform)\//.test(p),
    why: "the runtime is a corpus: its definitions, integrity, IR and addons are each measured separately",
    steps: ["definitions", "integrity-runtime", "assembles", "addons"],
    arms: ["node tooling/conformance/compiled-axis-floor.mjs   # node's own tests per module; lane-local, ~16 min"],
  },
  {
    name: "an instrument",
    when: (p) => /^tooling\/(conformance|census|differential|gate)\/.*\.(mjs|sh)$/.test(p),
    why: "an instrument first finds itself; a loop that has never had input is untested code",
    steps: [],
    arms: [
      "its --self-test, if it has one, and the gate step that runs it",
      "a sabotage arm: break the thing it guards and watch it fail, naming the thing",
      "feed any list it loops over one entry, in a scratch copy, before relying on it",
      "run it from a worktree, and every mode it has: the one its author tests is the easy one",
      "if it parses a node helper's output: process.stdout.write(String(x)), never console.log(x)",
    ],
  },
  {
    name: "the gate script",
    when: (p) => p === "tooling/gate/all.sh",
    why: "shared by every lane, and bash reads a running script incrementally",
    steps: [],
    arms: [
      "sh -n tooling/gate/all.sh, then the steps you touched with NTS_GATE_STEPS, from a worktree",
      "announce it to the lanes; never edit it while a run from this tree is executing",
    ],
  },
  {
    name: "an outcomes fixture",
    when: (p) => /^tooling\/conformance\/outcomes\//.test(p),
    why: "a record is a claim about main: recorded from a clean build, with a control that differs in one thing",
    steps: ["outcomes", "integrity"],
    arms: [
      "record it with NTS_BIN=<a clean main build> node tooling/conformance/outcomes-check.mjs --record <name>",
      "the control arm, measured: the same program differing in one thing agrees",
    ],
  },
];

/** Every change, whatever it touched: the gate's first two steps. */
const ALWAYS = {
  name: "every change",
  why: "a one-line edit is not exempt; the gate fails clippy on any warning, and `tests` stops at the first failing target",
  steps: ["clippy", "tests"],
  arms: [],
};

/** `{ path, added }` for the change asked about. */
function changedPaths(argv) {
  const git = (...args) => execFileSync("git", args, { cwd: TREE, encoding: "utf8" });
  const parse = (text) => text.split("\n").filter(Boolean).map((l) => {
    const [status, ...rest] = l.split("\t");
    return { path: rest[rest.length - 1], added: status.startsWith("A") };
  });
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const commit = at("--commit");
  if (commit) return parse(git("diff", "--name-status", `${commit}^`, commit));
  const since = at("--since");
  const tracked = parse(git("diff", "--name-status", since ?? "HEAD"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((path) => ({ path, added: true }));
  return [...tracked, ...untracked];
}

/** The rules a change matches, each with the paths that matched it. */
export function owed(changes) {
  const out = [];
  for (const rule of RULES) {
    const paths = changes.filter(({ path, added }) => rule.when(path, added)).map((c) => c.path);
    if (paths.length > 0) out.push({ ...rule, paths });
  }
  if (changes.length > 0) out.push({ ...ALWAYS, paths: [] });
  return out;
}

/**
 * The gate steps a set of rules owes, deduplicated, `build` first and the
 * cheap always-owed ones next: `all.sh` stops at the first failing step, so
 * clippy failing in a minute beats it failing after an hour of backends.
 */
export function gateSteps(rules) {
  const always = new Set(ALWAYS.steps);
  const rest = rules.flatMap((r) => r.steps).filter((s) => !always.has(s));
  return rules.length === 0 ? [] : ["build", ...ALWAYS.steps, ...new Set(rest)];
}

// **Seen to select before it is trusted**, on the three changes that motivated it.
function selfTest() {
  const names = (changes) => owed(changes).map((r) => r.name).join(", ");
  const example = names([{ path: "examples/is-array-of-object/tsconfig.json", added: true }, { path: "examples/is-array-of-object/src/main.ts", added: true }]);
  if (!example.includes("a new example") || example.includes("an example changed")) return `a new example: ${example}`;
  const blocked = names([{ path: "tooling/conformance/build-floor.sh", added: false }]);
  if (!blocked.includes("an instrument")) return `a change to build-floor.sh: ${blocked}`;
  const backend = names([{ path: "compiler/codegen/c/src/emit.rs", added: false }]);
  if (!backend.includes("the C backend") || !backend.includes("every change")) return `a backend change: ${backend}`;
  const helper = names([{ path: "runtime/c/nts_runtime.h", added: false }]);
  if (!helper.includes("a runtime helper") || !helper.includes("the C runtime")) return `a runtime header change: ${helper}`;
  if (owed([]).length !== 0) return "an empty change owed something";
  const order = gateSteps(owed([{ path: "compiler/codegen/llvm/src/lib.rs", added: false }]));
  if (order.join(" ") !== "build clippy tests llvm llvm-rc assembles") return `the LLVM backend's steps: ${order.join(" ")}`;
  return null;
}

const argv = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: a new example, an instrument, a backend and a runtime header each select their arms");
  process.exit(0);
}

// The gate runs the tree as it stands, which is not the tree of a past commit.
if (argv.includes("--run") && argv.includes("--commit")) {
  console.log("  --run with --commit would gate today's tree for another commit's change; check that commit out in a worktree and run from there");
  process.exit(2);
}
const changes = changedPaths(argv);
if (changes.length === 0) {
  console.log(`  no change in ${TREE}: nothing owed`);
  process.exit(0);
}
const rules = owed(changes);
const steps = gateSteps(rules);
const gate = `NTS_GATE_STEPS="${steps.join(" ")}" sh tooling/gate/all.sh`;
console.log(`  ${changes.length} path(s) changed in ${TREE}`);
for (const r of rules) {
  console.log(`\n  ${r.name}${r.paths.length ? ` (${r.paths.slice(0, 3).join(", ")}${r.paths.length > 3 ? `, +${r.paths.length - 3}` : ""})` : ""}`);
  console.log(`    why: ${r.why}`);
  if (r.steps.length > 0) console.log(`    gate: ${r.steps.join(" ")}`);
  for (const a of r.arms) console.log(`    [ ] ${a}`);
}
console.log(`\n  the gate steps owed, in one run:\n    ${gate}`);
if (argv.includes("--run")) {
  console.log(`\n  running them in ${TREE}\n`);
  const run = spawnSync("sh", ["tooling/gate/all.sh"], { cwd: TREE, stdio: "inherit", env: { ...process.env, NTS_GATE_STEPS: steps.join(" ") } });
  const left = rules.flatMap((r) => r.arms).length;
  console.log(`\n  gate steps: ${run.status === 0 ? "green" : `FAILED (exit ${run.status ?? run.signal})`}; ${left} arm(s) above are still yours`);
  process.exit(run.status === 0 ? 0 : 1);
}
