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
// Build both with `tooling/conformance/pin.ts <rev> [--worktree <dir>]`: a
// pin records its commit and what was applied, and every comparison tool then
// prints what separates the two arms, and how many of those commits touch
// what the binary is built from.

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
 * What each instrument asks, and of which kind -- because the failure this
 * file exists for is rarely "forgot to run a step". It is "ran four steps that
 * all asked one question". An unsound narrowing passed a fixture, two
 * differentials, a census reading -22 refusals and +146 definitions, and
 * clippy (2026-09): every one counted *whether* code compiles, and the defect
 * was a wrong answer -- and more code compiling is exactly what unsoundness
 * looks like from a reach instrument.
 *
 *   answers   what the program does, against node or against itself
 *   whether   whether code is emitted: a count, which rises with unsoundness too
 *   valid     whether an artefact or record is well-formed
 *   hygiene   the tree's own rules
 */
export const ASKS = {
  build: ["hygiene", "does it build"],
  clippy: ["hygiene", "does it lint clean"],
  tests: ["answers", "do the unit tests pass, including the runtime tables"],
  format: ["hygiene", "is runtime/c formatted"],
  examples: ["answers", "does every example answer as node does, on C"],
  llvm: ["answers", "the same on LLVM"],
  "llvm-rc": ["answers", "the same on LLVM with reference counting"],
  jvm: ["answers", "the same on the JVM, whose verifier types what C (`T *`) and LLVM (`ptr`) agree on by construction"],
  dex: ["valid", "does d8 accept what the JVM backend emits"],
  rc: ["answers", "the same on C with reference counting, where a lifetime error shows"],
  outcomes: ["answers", "does each pinned defect still do exactly what it did"],
  integrity: ["valid", "is every refusal, cut and location honest, over examples, blockers and outcomes"],
  "integrity-runtime": ["valid", "the same over the runtime"],
  definitions: ["whether", "did the runtime's reach go down, per module"],
  assembles: ["valid", "is the runtime's LLVM valid IR"],
  "snapshot-cache": ["valid", "is a cached snapshot the same program as a fresh one"],
  types: ["valid", "is the snapshot's type table consistent"],
  "bench-agree": ["answers", "does every backend build and agree on the benchmarks"],
  memory: ["answers", "does counting leak or free twice, measured by live objects"],
  "example-refusals": ["valid", "is every example's recorded refusal row still exactly what lowering prints"],
  blockers: ["valid", "does every blocker still refuse with its `// expect:` line"],
  "test262-cases": ["answers", "does every recorded test/language case still do what it did, read from the printed diagnostics"],
  "test262-builtins-cases": ["answers", "the same over test/built-ins"],
  "test262-rest-cases": ["answers", "the same over test/annexB, test/staging and test/harness"],
  addons: ["valid", "does each runtime module build, load and publish something"],
};

/** The comparisons a lowering change owes, each with the question only it answers. */
const COMPARE = [
  { kind: "answers", asks: "which code is emitted: does every example answer as it did, case by case", run: "node tooling/differential/agree.mjs <before> <after>   # and NTS_BACKEND=llvm, NTS_BACKEND=jvm, NTS_RC=1" },
  { kind: "whether", asks: "whether code is emitted: which functions stopped, started, or lost their root", run: "node tooling/conformance/refusal-diff.ts <before> <after>   # 0 moves is not no effect" },
  { kind: "answers", asks: "expected neutral? neutral has two causes -- the construct is absent, or the arm never fired -- and only one is good: which runtime modules emit differently, and what node's tests say of them", run: "node tooling/conformance/emitted-diff.ts <before> <after> --axis" },
];

/**
 * What a change owes, as data. `when` sees one changed path and whether it is
 * new; `steps` are gate steps, `arms` what the gate cannot do, each a question
 * first. An arm with `if` depends on what the change *is* -- a type rule, a
 * representation -- which no path says; it is printed as a condition rather
 * than dropped.
 */
export const RULES = [
  {
    name: "a new example",
    when: (p, added) => added && /^examples\/[^/]+\/tsconfig\.json$/.test(p),
    steps: ["examples", "llvm", "llvm-rc", "jvm", "rc", "integrity"],
    arms: [
      { kind: "answers", asks: "does it agree on every backend -- by hand, because the differential reads the shared tree and cannot see an example not yet in it", run: "node tooling/differential/agree.mjs <after> --only=<example>   # and NTS_BACKEND=llvm, llvm+NTS_RC=1, jvm, NTS_RC=1" },
      { kind: "answers", asks: "does it guard the change: it must not agree on the binary before", run: "node tooling/differential/agree.mjs <before> <after> --only=<example>" },
      { kind: "hygiene", asks: "can a pinned gate see it", run: "commit it before a pinned gate run: a worktree gate cannot see an uncommitted example" },
    ],
  },
  {
    name: "an example changed",
    when: (p, added) => !added && /^examples\/[^/]+\//.test(p),
    steps: ["examples", "llvm", "llvm-rc", "jvm", "rc"],
    arms: [],
  },
  {
    name: "lowering",
    when: (p) => /^compiler\/core\//.test(p),
    // The refusal tables are read by four steps, and a change that adds or
    // rewords a refusal moves them whatever it compiles: c3eeff139 gained
    // ~10 rows in 26 of 29 projects with program.c byte-identical.
    //
    // **And the recorded test262 sets**, the largest corpus a lowering change
    // reaches: on 2026-09-29 two changes that were green on every step above
    // regressed recorded passes by the hundred -- `any` as Erased (243, the
    // `var f;` shape) and generator expressions (112, private generator
    // methods; landed, and reddened main) -- and only these steps saw either.
    // A byte-identical emitted-diff does not clear them: it reads the runtime
    // corpus, which has no class declared in a block, no generator function
    // expression and no method handed out as a value, and three changes that
    // night emitted 29 of 29 projects identically while moving recorded rows.
    // Where evaluation goes missing is a site that decides "nothing to do"
    // from the wrong quantity: `typeof` answered from the type and skipped its
    // operand, a class declaration answered `Ok(())` and skipped its statics,
    // and a pattern that binds no names skipped its initializer. Each dropped
    // effects silently and made recorded passes hollow (21, 1 and 6 rows).
    steps: ["examples", "llvm", "llvm-rc", "jvm", "rc", "outcomes", "integrity", "integrity-runtime", "definitions", "example-refusals", "blockers", "test262-cases", "test262-builtins-cases", "test262-rest-cases"],
    arms: [
      ...COMPARE,
      { if: "a type rule", kind: "answers", asks: "a generic class with two live instantiations appears in the corpus, never in a hand-written fixture", run: "the emitted-diff --axis above, and a full census per-case diff (conformance262.ts --rows, both binaries)" },
      { if: "a representation change", kind: "answers", asks: "only the JVM types references; C and LLVM agree by construction", run: "NTS_BACKEND=jvm node tooling/differential/agree.mjs <before> <after>" },
      { if: "it records, rewords or removes a refusal", kind: "whether", asks: "which refusal rows moved, and in which tables -- the byte-identical C cannot say. Blockers is not a formality behind the census here: it is the only corpus that holds a refusal about some constructs (an evolving type's, 2026-09-30, where every other step was green on a wrong phrasing)", run: "node tooling/census/messages.ts <before> <after>; the example-refusals, blockers, outcomes and integrity steps above hold the tables" },
      { if: "meant to make programs compile", kind: "answers", asks: "did it buy cases, per file -- --recorded cannot see a gain", run: "a full census for both binaries, per-case diff; check the prediction against the last run's rows first" },
    ],
  },
  {
    name: "reference counting",
    when: (p) => /^compiler\/core\/src\/hir\/(rc|own)\.rs$/.test(p),
    steps: ["rc", "llvm-rc", "memory"],
    arms: [
      { kind: "answers", asks: "where releases go: the default provider is no-gc, rc.rs never runs, and a diff without --rc reads byte-identical whatever this changed", run: "node tooling/conformance/emitted-diff.ts <before> <after> --rc --axis" },
      { kind: "answers", asks: "does every example still answer under counting", run: "NTS_RC=1 node tooling/differential/agree.mjs <before> <after>" },
      { kind: "valid", asks: "is the runtime's counted LLVM IR valid -- `assembles` without --rc emits no release", run: "NTS_BIN=<after> node tooling/conformance/assembles.ts --rc" },
    ],
  },
  {
    name: "the C backend",
    when: (p) => /^compiler\/codegen\/c\//.test(p),
    steps: ["examples", "rc", "outcomes", "snapshot-cache", "test262-cases", "test262-builtins-cases", "test262-rest-cases"],
    arms: [COMPARE[0], COMPARE[2]],
  },
  {
    name: "the LLVM backend",
    when: (p) => /^compiler\/codegen\/llvm\//.test(p),
    steps: ["llvm", "llvm-rc", "assembles"],
    arms: [{ kind: "answers", asks: "which code is emitted, on LLVM", run: "NTS_BACKEND=llvm node tooling/differential/agree.mjs <before> <after>; NTS_RC=1 ..." }],
  },
  {
    name: "the JVM backend",
    when: (p) => /^compiler\/codegen\/jvm\//.test(p),
    steps: ["jvm", "dex"],
    arms: [
      { kind: "answers", asks: "which code is emitted, on the JVM", run: "NTS_BACKEND=jvm node tooling/differential/agree.mjs <before> <after>" },
      { kind: "valid", asks: "does the runtime's JVM output pass the verifier -- the jvm step runs examples only", run: "NTS_BIN=<after> node tooling/conformance/jvm-verifies.ts" },
    ],
  },
  {
    name: "the frontend or the snapshot schema",
    when: (p) => /^compiler\/(frontend-ts|semantic-schema)\//.test(p),
    steps: ["snapshot-cache", "types", "examples", "test262-cases", "test262-builtins-cases", "test262-rest-cases"],
    arms: [
      { kind: "hygiene", asks: "does a cache written by the old schema get rejected", run: "bump SCHEMA_VERSION if a semantic-schema struct changed" },
      { kind: "valid", asks: "the examples' type tables too, not only the runtime's", run: "NTS_BIN=<after> node tooling/conformance/types-check.mjs --examples" },
      { if: "a new TypeKind variant", kind: "valid", asks: "can types-check read it", run: "add it to types-check.mjs's KINDS, or every type of it reads as unread" },
    ],
  },
  {
    name: "a runtime helper",
    when: (p) => /^runtime\/c\/nts_runtime\.h$/.test(p),
    steps: ["tests", "bench-agree"],
    arms: [
      { kind: "valid", asks: "do the four cross-check tables and nts-core's sorted table name it", run: "nts-core runtime_signatures, nts-codegen-llvm signatures, nts-codegen-c ERASES_CLASS, nts-codegen-jvm REFUSED_FLOOR -- all read by `tests`" },
    ],
  },
  {
    name: "the C runtime",
    when: (p) => /^runtime\/c\//.test(p),
    steps: ["format", "examples", "rc", "llvm", "assembles"],
    arms: [
      { kind: "hygiene", asks: "is the binary testing the new runtime", run: "rebuild nts: runtime/c is include_str!-ed, so an old binary tests the old runtime" },
      COMPARE[0],
      COMPARE[2],
    ],
  },
  {
    name: "a runtime module",
    when: (p) => /^runtime\/(node|web-platform)\//.test(p),
    steps: ["definitions", "integrity-runtime", "assembles", "addons"],
    arms: [{ kind: "answers", asks: "what node's own tests say of each compiled module", run: "node tooling/conformance/compiled-axis-floor.mjs   # lane-local, ~16 min" }],
  },
  {
    // A printed diagnostic is an interface: eleven readers anchored on `^TS`,
    // three of them gate steps, and ff7e6444a's diff showed neither an example
    // nor a table -- nothing in it said who parses the line it changed.
    name: "the printed diagnostics",
    when: (p) => /^(tooling\/cli\/src|compiler\/diagnostics|tooling\/differential\/src)\//.test(p),
    steps: ["outcomes", "integrity", "example-refusals", "blockers", "test262-cases", "test262-builtins-cases", "test262-rest-cases"],
    arms: [
      { if: "it changes what a printed diagnostic line says or how it is shaped", kind: "valid", asks: "who parses this line: every reader of it, widened to accept both shapes before the shape changes", run: "git grep -nE 'TS(.d|.0-9)|refused:|not (rendered|emitted):' -- '*.mjs' '*.sh' '*.ts' ':!*.d.ts'   # `.` is the \\ of a JS reader's \\d and the [ of a shell one's [0-9]" },
    ],
  },
  {
    name: "an instrument",
    when: (p) => /^tooling\/(conformance|census|differential|gate)\/.*\.(mjs|sh)$/.test(p),
    steps: [],
    arms: [
      { kind: "valid", asks: "does it catch what it guards", run: "its --self-test, and a sabotage arm: break the thing it guards and watch it fail, naming the thing" },
      { kind: "valid", asks: "has every loop in it had input", run: "feed any list it loops over one entry, in a scratch copy, before relying on it" },
      { kind: "valid", asks: "does a clean result mean it judged something", run: "print the population beside the verdict" },
      { kind: "valid", asks: "does it work where it will be run", run: "run it from a worktree, and every mode it has: the one its author tests is the easy one" },
    ],
  },
  {
    name: "the gate script",
    when: (p) => p === "tooling/gate/all.sh",
    steps: [],
    arms: [
      { kind: "valid", asks: "does it parse, and do the touched steps run", run: "sh -n tooling/gate/all.sh, then those steps with NTS_GATE_STEPS, from a worktree" },
      { kind: "hygiene", asks: "do the lanes know", run: "announce it; never edit it while a run from this tree is executing" },
    ],
  },
  {
    name: "an outcomes fixture",
    when: (p) => /^tooling\/conformance\/outcomes\//.test(p),
    steps: ["outcomes", "integrity"],
    arms: [
      { kind: "hygiene", asks: "is the record a claim about main", run: "record it with NTS_BIN=<a clean main build> node tooling/conformance/outcomes-check.ts --record <name>" },
      { kind: "answers", asks: "is the defect specific to what the fixture names", run: "a control differing in one thing, measured" },
    ],
  },
];

/** Every change, whatever it touched: the gate's first two steps. */
const ALWAYS = { name: "every change", when: () => true, steps: ["clippy", "tests"], arms: [] };

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
  const printed = owed([{ path: "tooling/cli/src/main.rs", added: false }]).find((r) => r.name === "the printed diagnostics");
  if (!printed?.steps.includes("test262-cases") || !printed.arms.some((a) => /git grep/.test(a.run))) return "a change to the driver's printing does not owe its readers";
  const lowered = owed([{ path: "compiler/core/src/hir/lower.rs", added: false }]).find((r) => r.name === "lowering");
  if (!["test262-cases", "test262-builtins-cases", "test262-rest-cases"].every((st) => lowered.steps.includes(st))) return "a lowering change does not owe the recorded test262 sets";
  const order = gateSteps(owed([{ path: "compiler/codegen/llvm/src/lib.rs", added: false }]));
  if (order.join(" ") !== "build clippy tests llvm llvm-rc assembles") return `the LLVM backend's steps: ${order.join(" ")}`;
  // A step without its question could not say what it asks.
  for (const r of [...RULES, ALWAYS]) for (const st of r.steps) if (!ASKS[st]) return `rule "${r.name}" names gate step "${st}", which ASKS does not describe`;
  for (const st of ["build"]) if (!ASKS[st]) return `ASKS lacks "${st}"`;
  const lowering = owed([{ path: "compiler/core/src/hir/lower.rs", added: false }]).find((r) => r.name === "lowering");
  const asked = new Set(lowering.arms.filter((a) => !a.if).map((a) => a.kind));
  if (!asked.has("answers") || !asked.has("whether")) return `a lowering change owes only ${[...asked].join(", ")}`;
  if (!lowering.arms.some((a) => /emitted-diff/.test(a.run))) return "a lowering change does not owe the emitted-C diff that tells neutral's two causes apart";
  return null;
}

const argv = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: each change selects its arms; every gate step says what it asks; lowering owes answers, counts and the emitted-C diff");
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
const arm = (a) => `${a.if ? `if ${a.if}: ` : ""}${a.asks}\n        ${a.run}`;
console.log(`  ${changes.length} path(s) changed in ${TREE}`);
for (const r of rules) {
  console.log(`\n  ${r.name}${r.paths.length ? ` (${r.paths.slice(0, 3).join(", ")}${r.paths.length > 3 ? `, +${r.paths.length - 3}` : ""})` : ""}`);
  for (const a of r.arms) console.log(`    [ ] [${a.kind}] ${arm(a)}`);
  if (r.steps.length > 0) console.log(`    gate: ${r.steps.join(" ")}`);
}
console.log("\n  the gate steps owed, and what each asks:");
for (const step of steps) console.log(`    ${step.padEnd(18)} [${ASKS[step][0]}] ${ASKS[step][1]}`);
console.log(`  in one run:\n    ${gate}`);
// Which questions the change owes, by kind: four instruments asking one
// question is the failure this prints against.
const kinds = new Map();
for (const k of [...steps.map((st) => ASKS[st][0]), ...rules.flatMap((r) => r.arms.filter((a) => !a.if).map((a) => a.kind))]) kinds.set(k, (kinds.get(k) ?? 0) + 1);
console.log(`\n  owed, by what they ask: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ")}`);
const compiler = rules.some((r) => ["lowering", "the C backend", "the LLVM backend", "the JVM backend", "the frontend or the snapshot schema", "the C runtime"].includes(r.name));
if (compiler && !rules.some((r) => r.arms.some((a) => a.kind === "answers" && !a.if && /<before> <after>/.test(a.run)))) {
  console.log("  NOTE: nothing owed here compares what programs answer across the change; counts rise with unsoundness too");
}
if (argv.includes("--run")) {
  console.log(`\n  running them in ${TREE}\n`);
  const run = spawnSync("sh", ["tooling/gate/all.sh"], { cwd: TREE, stdio: "inherit", env: { ...process.env, NTS_GATE_STEPS: steps.join(" ") } });
  const left = rules.flatMap((r) => r.arms).length;
  console.log(`\n  gate steps: ${run.status === 0 ? "green" : `FAILED (exit ${run.status ?? run.signal})`}; ${left} arm(s) above are still yours`);
  process.exit(run.status === 0 ? 0 : 1);
}
