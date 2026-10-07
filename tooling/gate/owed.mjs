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
// # What a path owes, when no rule names it
//
// **A path no rule matches owes the full gate**: a list of rules is a claim
// about what each path reaches, and a path nobody thought about is exactly the
// one whose reach nobody knows. Three maps derived from the tree narrow that
// before the default applies, so a rule does not have to be written for every
// file:
//
//   - **the crate graph** (`cargo metadata`): a change in a crate is a change
//     in every crate that depends on it, so `compiler/semantic-schema` owes
//     what `compiler/core` and every backend owe, through them;
//   - **the corpora's tsconfigs**: a file a gated program's tsconfig includes
//     (`files`, `include`, `extends`, `paths`) is an input to the steps that
//     compile that corpus -- runtime/chromium/dom/types/*.d.ts is part of
//     three blockers fixtures, so it owes `blockers`;
//   - **what each step runs**: the files all.sh's step bodies name, and what
//     those scripts name and import in turn, owe that step.
//
// The runner itself (all.sh, run.mjs, the tokens, pinned.sh) owes the full gate.
// A program's imports beyond its tsconfig are not followed: such a file is
// matched by a rule or by nothing, and nothing is the full gate.
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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  "jvm-verifies": ["valid", "does the runtime's and the outcomes' JVM output load, verify and link -- the jvm step runs examples only"],
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
  // A corpus of its own, and the only step that compiles it: `any` as Erased
  // (093733f2d) left awfy-towers emitting C that clang rejects, and nothing a
  // lowering change owed pointed at it until another lane found it red.
  "benches": ["answers", "does every benches/cases program still emit C that compiles and runs"],
  addons: ["valid", "does each runtime module build, load and publish something"],
  "compile-time": ["hygiene", "did lowering any runtime module get twice as slow (instructions, perf-counted)"],
  profile: ["whether", "does runtime/node emit without a panic, under the refusal ceiling, above the definition floor"],
  interop: ["answers", "does every interop project build the way its README says and run"],
  divergence: ["valid", "do node's divergence instruments still hold"],
  sweep: ["answers", "does the value-kind cross-product agree on C"],
  corpus: ["valid", "invalid HIR 0, uncompilable C 0, unverifiable class 0 over the suite"],
  "on-device": ["answers", "do the bench cases agree on java and dalvikvm, on a device"],
  test262: ["valid", "is the test262 pin reachable, the inventory and the features audit current"],
  config: ["valid", "are the nts.config.ts files coherent"],
  "react-sources": ["valid", "do the vendored React sources match their manifest"],
  primitives: ["valid", "does every name docs/primitives.md cites exist"],
  records: ["hygiene", "is every record number used once"],
  reformat: ["hygiene", "no whitespace-only diffs"],
  tooling: ["valid", "do the gate's own tools pass their tests (tokens, owed)"],
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
    // effects silently; two of them had made recorded passes hollow (21 rows
    // for `typeof`, 6 for the pattern).
    //
    // **And `jvm-verifies`, because a change that compiles more code publishes
    // the JVM's latent defects in it.** 1cf6a7ebe (`.then`) was green on every
    // step this rule listed and turned `jvm-verifies` red on main: buffer's
    // `module#init` stopped refusing, so two module-scope IIFEs compiled for the
    // first time, and the JVM left their `erased_call$raises` abstract. The `jvm`
    // step runs examples only; the runtime corpus is what `jvm-verifies` reads.
    //
    // **And the runtime corpus's other readers, and compile-time**, the step
    // written for a lowering that got slower: a lowering change reaches every
    // program the gate compiles, so addons, profile, assembles, memory,
    // bench-agree, corpus and dex read its output as much as examples does.
    steps: ["examples", "llvm", "llvm-rc", "jvm", "rc", "outcomes", "integrity", "integrity-runtime", "definitions", "example-refusals", "blockers", "test262-cases", "test262-builtins-cases", "test262-rest-cases", "benches", "jvm-verifies", "compile-time", "addons", "profile", "assembles", "memory", "bench-agree", "corpus", "dex"],
    arms: [
      ...COMPARE,
      { if: "a type rule", kind: "answers", asks: "a generic class with two live instantiations appears in the corpus, never in a hand-written fixture", run: "the emitted-diff --axis above, and a full census per-case diff (conformance262.ts --rows, both binaries)" },
      { if: "a representation change", kind: "answers", asks: "only the JVM types references; C and LLVM agree by construction", run: "NTS_BACKEND=jvm node tooling/differential/agree.mjs <before> <after>" },
      { if: "it records, rewords or removes a refusal", kind: "whether", asks: "which refusal rows moved, and in which tables -- the byte-identical C cannot say. Blockers is not a formality behind the census here: it is the only corpus that holds a refusal about some constructs (an evolving type's, 2026-09-30, where every other step was green on a wrong phrasing)", run: "node tooling/census/messages.ts <before> <after>; the example-refusals, blockers, outcomes and integrity steps above hold the tables" },
      { if: "meant to make programs compile", kind: "answers", asks: "did it buy cases, per file -- --recorded cannot see a gain", run: "node tooling/census/rerun.ts --rows <census rows> --message '<the root it clears>' --before <control> --after <pin>: FIXED is a pass bought, MOVED the next blocker. On 2026-09-30 a change aimed at 117 sole-root files read 0 FIXED, 299 MOVED here, and nothing else could have said so. A full census for both binaries only when the root is not one message" },
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
    steps: ["examples", "rc", "outcomes", "snapshot-cache", "test262-cases", "test262-builtins-cases", "test262-rest-cases", "benches"],
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
    // `.ts` since the lanes' tools became TypeScript (2026-09-29): until then
    // this matched none of them, and no instrument change owed a self-test.
    // The fixture trees are programs, not instruments, and have rules below.
    when: (p) => /^tooling\/(conformance|census|differential|gate)\/.*\.(mjs|ts|sh)$/.test(p) && !/^tooling\/conformance\/(outcomes|blockers)\//.test(p),
    // Owes what runs it, from the derived map of what each step runs (see
    // `stepInputs`); an instrument that map cannot place owes the full gate.
    placedBy: "stepInputs",
    steps: [],
    arms: [
      { kind: "valid", asks: "does it catch what it guards", run: "its --self-test, and a sabotage arm: break the thing it guards and watch it fail, naming the thing" },
      { kind: "valid", asks: "has every loop in it had input", run: "feed any list it loops over one entry, in a scratch copy, before relying on it" },
      { kind: "valid", asks: "does a clean result mean it judged something", run: "print the population beside the verdict" },
      { kind: "valid", asks: "does it work where it will be run", run: "run it from a worktree, and every mode it has: the one its author tests is the easy one" },
    ],
  },
  {
    // The runner decides what every step is given and how a verdict is read:
    // a change to it can change any step's answer.
    name: "the gate's runner",
    when: (p) => /^tooling\/gate\/(all\.sh|run\.mjs|token\.sh|tokens\.mjs|tokenpool\.mjs|pinned\.sh)$/.test(p),
    full: true,
    steps: [],
    arms: [
      { kind: "valid", asks: "does it parse, and do the touched steps run", run: "sh -n tooling/gate/all.sh; node --test tooling/gate/*.test.mjs; then the steps, from a worktree" },
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
  {
    // A fixture is a program, so it is an input to `integrity`, and one that
    // pins a refusal shows that refusal's structural consequences -- a cut
    // module-scope statement -- which want their `integrity.known` entries in
    // the same commit. On 2026-09-29 two fixtures moved here from outcomes/
    // reddened integrity for exactly that.
    name: "a blockers fixture",
    when: (p) => /^tooling\/conformance\/blockers\//.test(p),
    steps: ["blockers", "integrity"],
    arms: [
      { kind: "hygiene", asks: "is the `// expect:` line the refusal main prints", run: "emit-c it on a clean main build and copy the NTS1001 text, names included" },
      { kind: "hygiene", asks: "will it fail for the gap being fixed", run: "when the refusal is only a means, pick a documented permanent gap (a RegExp field, a stack read), not whatever refuses today" },
    ],
  },
  // **One rule per workspace crate the rules above do not name**, so that the
  // crate graph (see `owed`) can add each crate's reach to the crates under
  // it. A crate the graph reaches that has no rule owes the full gate.
  {
    name: "the N-API backend",
    when: (p) => /^compiler\/codegen\/napi\//.test(p),
    steps: ["addons", "profile", "divergence"],
    arms: [],
  },
  {
    name: "the memory lowering",
    when: (p) => /^compiler\/memory-lowering\//.test(p),
    steps: ["rc", "llvm-rc", "memory", "examples", "llvm", "addons"],
    arms: [],
  },
  {
    name: "the debug lowering",
    when: (p) => /^compiler\/debug-lowering\//.test(p),
    steps: ["examples", "rc", "llvm"],
    arms: [],
  },
  {
    name: "the backends' common code",
    when: (p) => /^compiler\/codegen\/common\//.test(p),
    steps: ["examples", "llvm", "jvm", "rc", "llvm-rc", "assembles", "jvm-verifies", "dex", "bench-agree", "benches"],
    arms: [],
  },
  {
    name: "the JVM class writer",
    when: (p) => /^compiler\/jvm-emitter\//.test(p),
    steps: ["jvm", "dex", "jvm-verifies", "bench-agree", "on-device"],
    arms: [],
  },
  {
    // nts.config.ts, targets, `nts build`: what interop and the Android steps build through.
    name: "the build driver",
    when: (p) => /^build\//.test(p),
    steps: ["interop", "config", "dex", "on-device", "bench-agree", "jvm"],
    arms: [],
  },
  {
    name: "the CLI",
    when: (p) => /^tooling\/cli\//.test(p),
    steps: ["interop", "config", "addons", "profile", "dex", "bench-agree", "examples", "llvm", "jvm", "rc"],
    arms: [],
  },
  {
    name: "the dependency installer, the surfaces and the React compiler",
    when: (p) => /^(tooling\/deps|tooling\/surfaces|runtime\/react\/compiler)\//.test(p),
    steps: ["interop", "config", "react-sources", "examples"],
    arms: [],
  },
  {
    name: "the bench driver",
    when: (p) => /^tooling\/bench\//.test(p),
    steps: ["benches", "bench-agree", "on-device"],
    arms: [],
  },
  {
    name: "the suite and the test262 protocol",
    when: (p) => /^tooling\/suite\//.test(p),
    steps: ["corpus", "test262", "test262-cases", "test262-builtins-cases", "test262-rest-cases"],
    arms: [],
  },
  {
    // Read by two steps and by people; no program compiles a page of it.
    name: "documentation",
    when: (p) => /\.md$/.test(p) && !/^(examples|benches|tooling\/(conformance|memory)|runtime)\//.test(p),
    steps: ["records", "primitives"],
    arms: [],
  },
  {
    // What each step cost on a healthy run: it orders the next run and warns
    // when a step is much slower. No step's verdict reads it.
    name: "the gate's step times",
    when: (p) => p === "tooling/gate/times.tsv",
    settled: true,
    steps: [],
    arms: [{ kind: "hygiene", asks: "were they taken on a healthy run", run: "NTS_GATE_RECORD_TIMES=1 on a full gate whose summary you have read" }],
  },
  {
    name: "the gate's own tests",
    when: (p) => /^tooling\/gate\/([^/]+\.test\.mjs|owed\.mjs)$/.test(p),
    steps: ["tooling"],
    arms: [],
  },
];

/** Every change, whatever it touched: the gate's first two steps. */
const ALWAYS = { name: "every change", when: () => true, steps: ["clippy", "tests"], arms: [] };

/**
 * `{ path, added, deleted }` for the change asked about. A rename or copy is
 * both of its paths: the old one deleted (moving a fixture out of blockers/
 * still owes blockers) and the new one added (moving one into examples/ is a
 * new example).
 */
export function parseNameStatus(text) {
  const out = [];
  for (const l of text.split("\n").filter(Boolean)) {
    const [status, ...rest] = l.split("\t");
    if (/^[RC]/.test(status) && rest.length >= 2) {
      if (status.startsWith("R")) out.push({ path: rest[0], added: false, deleted: true });
      out.push({ path: rest[1], added: true, deleted: false });
    } else {
      out.push({ path: rest[rest.length - 1], added: status.startsWith("A"), deleted: status.startsWith("D") });
    }
  }
  return out;
}

function changedPaths(argv) {
  const git = (...args) => execFileSync("git", args, { cwd: TREE, encoding: "utf8" });
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const commit = at("--commit");
  if (commit) return parseNameStatus(git("diff", "--name-status", "-M", `${commit}^`, commit));
  const since = at("--since");
  const tracked = parseNameStatus(git("diff", "--name-status", "-M", since ?? "HEAD"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((path) => ({ path, added: true, deleted: false }));
  return [...tracked, ...untracked];
}

// ---------------------------------------------------------------------------
// The maps derived from the tree. Each is read once per process, from TREE.
// ---------------------------------------------------------------------------
const memo = new Map();
const once = (key, f) => (memo.has(key) ? memo.get(key) : (memo.set(key, f()), memo.get(key)));
const rel = (abs) => relative(TREE, abs).split("\\").join("/");

/** Every step all.sh defines, in its order: what "the full gate" means. */
export function allSteps() {
  return once("steps", () => {
    const r = spawnSync("sh", [join(TREE, "tooling/gate/all.sh"), "--list"], { cwd: TREE, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`all.sh --list exited ${r.status}`);
    return r.stdout.split("\n").filter(Boolean);
  });
}

/** crate dir -> { name, deps: [dir], users: [dir] } for the workspace's crates. */
export function crates() {
  return once("crates", () => {
    let meta;
    try {
      meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--offline"], { cwd: TREE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 }));
    } catch {
      return null; // no cargo: crate paths fall to their rules, or to the full gate
    }
    const byName = new Map(meta.packages.map((p) => [p.name, rel(dirname(p.manifest_path))]));
    const out = new Map();
    for (const p of meta.packages) {
      const dir = rel(dirname(p.manifest_path));
      out.set(dir, { name: p.name, deps: [...new Set(p.dependencies.filter((d) => d.path && byName.has(d.name)).map((d) => byName.get(d.name)))], users: [] });
    }
    for (const [dir, c] of out) for (const d of c.deps) out.get(d)?.users.push(dir);
    return out;
  });
}

/** The crate a path is in (the longest crate directory above it), or null. */
export function crateOf(path) {
  const all = crates();
  if (!all) return null;
  let best = null;
  for (const dir of all.keys()) if ((path === dir || path.startsWith(`${dir}/`)) && (!best || dir.length > best.length)) best = dir;
  return best;
}

/** `dir` and every crate that depends on it, directly or not. */
export function dependents(dir) {
  const all = crates();
  const seen = new Set([dir]);
  const queue = [dir];
  while (queue.length) for (const u of all.get(queue.shift())?.users ?? []) if (!seen.has(u)) { seen.add(u); queue.push(u); }
  return [...seen];
}

/**
 * The gated corpora: which programs each compiles, and the steps that do.
 * `dirs` lists program directories; a program without a tsconfig.json is
 * compiled under tsconfig.fixtures.json (dexes.sh, bench cases).
 */
// `member` decides membership by the path alone, so a deleted or renamed
// program still owes its corpus: the tree no longer has it to list.
const CORPORA = [
  { name: "the examples", member: /^examples\/(?!interop\/)[^/]+\//, dirs: () => kids("examples").filter((d) => d !== "examples/interop"), steps: ["examples", "llvm", "llvm-rc", "jvm", "rc", "integrity", "example-refusals", "dex", "snapshot-cache"] },
  { name: "the interop projects", member: /^examples\/interop\/[^/]+\//, dirs: () => kids("examples/interop"), steps: ["interop"] },
  { name: "the blockers", member: /^tooling\/conformance\/blockers\/[^/]+\//, dirs: () => kids("tooling/conformance/blockers"), steps: ["blockers", "integrity"] },
  { name: "the outcomes", member: /^tooling\/conformance\/outcomes\/[^/]+\//, dirs: () => kids("tooling/conformance/outcomes"), steps: ["outcomes", "integrity", "jvm-verifies"] },
  { name: "the runtime modules", member: /^runtime\/(node\/[^/]+|web-platform)\//, dirs: () => [...kids("runtime/node"), "runtime/web-platform"], steps: ["definitions", "integrity-runtime", "compile-time", "assembles", "addons", "profile", "snapshot-cache", "types", "jvm-verifies", "divergence"] },
  { name: "the bench cases", member: /^benches\/cases\/[^/]+\//, dirs: () => kids("benches/cases"), steps: ["benches", "bench-agree", "dex"] },
  { name: "the memory cases", member: /^tooling\/memory\/cases\/[^/]+\//, dirs: () => kids("tooling/memory/cases"), steps: ["memory"] },
];
function kids(dir) {
  try {
    return readdirSync(join(TREE, dir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${dir}/${e.name}`);
  } catch {
    return [];
  }
}

/** A tsconfig's JSON: comments and trailing commas allowed, as tsc allows them. */
function readJsonc(path) {
  const text = readFileSync(path, "utf8");
  let out = "";
  for (let i = 0, str = false; i < text.length; i++) {
    const c = text[i];
    if (str) { out += c; if (c === "\\") out += text[++i] ?? ""; else if (c === '"') str = false; continue; }
    if (c === '"') { str = true; out += c; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2); if (i < 0) break; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** The files and directories a tsconfig takes its program from, repo-relative. */
export function tsconfigInputs(config, seen = new Set()) {
  const abs = resolve(TREE, config);
  if (seen.has(abs) || !existsSync(abs)) return [];
  seen.add(abs);
  const at = dirname(abs);
  const out = [rel(abs)];
  let json;
  try { json = readJsonc(abs); } catch { return out; }
  // The part of a glob before its first wildcard is the directory it reads.
  const root = (pattern) => rel(resolve(at, pattern.split(/[*?{[]/)[0] || ".")).replace(/\/$/, "");
  for (const f of json.files ?? []) out.push(rel(resolve(at, f)));
  for (const g of json.include ?? ["**/*"]) out.push(root(g));
  const ext = Array.isArray(json.extends) ? json.extends : json.extends ? [json.extends] : [];
  for (const e of ext) if (e.startsWith(".")) out.push(...tsconfigInputs(rel(resolve(at, e.endsWith(".json") ? e : `${e}.json`)), seen));
  const opts = json.compilerOptions ?? {};
  for (const targets of Object.values(opts.paths ?? {})) for (const t of targets) out.push(root(resolve(at, opts.baseUrl ?? ".", t)));
  for (const t of opts.typeRoots ?? []) out.push(root(t));
  return out;
}

/** input (file or directory, repo-relative) -> Set of corpus names. */
export function corpusInputs() {
  return once("corpora", () => {
    const map = new Map();
    const add = (input, corpus) => { if (!map.has(input)) map.set(input, new Set()); map.get(input).add(corpus); };
    for (const c of CORPORA) {
      for (const dir of c.dirs()) {
        const config = existsSync(join(TREE, dir, "tsconfig.json")) ? `${dir}/tsconfig.json` : null;
        add(dir, c.name);
        for (const input of config ? tsconfigInputs(config) : tsconfigInputs("tsconfig.fixtures.json")) {
          // A config's `include` of its own directory, or of the whole tree for
          // the shared fixtures config, says nothing a directory rule does not.
          if (input === "" || input === "." || (!config && input === "")) continue;
          add(input, c.name);
        }
      }
    }
    return map;
  });
}

/**
 * file or directory (repo-relative) -> Set of steps whose run reads it: the
 * paths a step's body in all.sh names, and what each named script names and
 * imports in turn.
 */
export function stepInputs() {
  return once("stepInputs", () => {
    const text = readFileSync(join(TREE, "tooling/gate/all.sh"), "utf8");
    const bodies = new Map();
    // A function's body runs to the next definition or step line: some are
    // one-liners (`llvm() { ( ...; backend_examples ... ); }`), and the
    // comments in between are dropped below.
    const starts = [...text.matchAll(/^([a-z_][a-z0-9_]*)\(\) \{/gm)];
    for (const [k, m] of starts.entries()) {
      const from = m.index + m[0].length;
      const rest = text.slice(from, k + 1 < starts.length ? starts[k + 1].index : text.length);
      const stop = rest.search(/^step "/m);
      bodies.set(m[1], stop < 0 ? rest : rest.slice(0, stop));
    }
    // A segment never ends in `.`: "... in tooling/x.ts." is the file, not "x.ts.".
    const PATH = /(?:^|[\s"'=(/$])((?:tooling|runtime|examples|benches|compiler|build|docs)(?:\/[A-Za-z0-9_.@+*-]*[A-Za-z0-9_@+*-])+)/g;
    // Code, not prose: a comment that mentions a path does not read it. A
    // directory of two segments (`tooling/conformance`, from a path built
    // with a variable) is too wide to mean anything and is dropped.
    const code = (body) => body.split("\n").filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join("\n");
    const named = (body) => [...code(body).matchAll(PATH)]
      .map((m) => m[1].replace(/\/\*.*$/, "").replace(/\/$/, ""))
      .filter((p) => p.split("/").length > 2 || /\.[a-z]+$/.test(p));
    const imports = (file, body) => [...body.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => rel(resolve(TREE, dirname(file), m[1])));
    const map = new Map();
    const add = (input, step) => { if (!map.has(input)) map.set(input, new Set()); map.get(input).add(step); };
    for (const m of text.matchAll(/^step "([a-z0-9-]+)"\s+(.+)$/gm)) {
      const step = m[1];
      const command = m[2].trim();
      const queue = [];
      // The step's function, and every all.sh function it calls (llvm calls
      // backend_examples, which runs agree.mjs).
      const fns = [command.split(/\s+/)[0]];
      for (let k = 0; k < fns.length; k++) {
        const body = bodies.get(fns[k]);
        if (body === undefined) continue;
        queue.push(...named(body));
        // Called: a function name where a command starts, not any word.
        for (const m of code(body).matchAll(/(?:^|[;&|(]|\$\(|then|do|else)\s*([a-z_][a-z0-9_]*)\b/gm)) {
          if (bodies.has(m[1]) && !fns.includes(m[1])) fns.push(m[1]);
        }
      }
      queue.push(...named(` ${command.replace(/^\.\//, "")}`));
      const seen = new Set();
      while (queue.length) {
        const input = normalize(queue.shift()).split("\\").join("/");
        if (seen.has(input)) continue;
        seen.add(input);
        add(input, step);
        const abs = join(TREE, input);
        let st;
        try { st = statSync(abs); } catch { continue; }
        // The runner names every step's tools; reading it would make each step
        // an input to all of them. It owes the full gate by its own rule.
        // owed.mjs and the tests name paths as cases, not as inputs.
        if (/^tooling\/gate\/(all\.sh|run\.mjs|owed\.mjs|[^/]+\.test\.mjs)$/.test(input)) continue;
        if (!st.isFile() || !/\.(sh|mjs|js|ts|py)$/.test(input) || st.size > 1 << 20) continue;
        const body = readFileSync(abs, "utf8");
        // A file the script reads or runs beside itself, `join(HERE, "x.tsv")`,
        // `join(HERE, "attempt262-worker.ts")`: a bare name in quotes that
        // exists in the script's directory.
        const beside = [...code(body).matchAll(/["']([A-Za-z0-9_.-]+\.(?:tsv|json|known|txt|csv|ts|mjs|js|sh|py))["']/g)]
          .map((m) => `${dirname(input)}/${m[1]}`).filter((f) => existsSync(join(TREE, f)));
        queue.push(...named(body), ...imports(input, body), ...beside);
      }
    }
    return map;
  });
}

/** The entries of `map` (input -> Set) that cover `path`: the path itself, or a directory above it. */
function covering(map, path) {
  const out = new Set();
  for (const [input, names] of map) if (path === input || path.startsWith(`${input}/`)) for (const n of names) out.add(n);
  return out;
}

/**
 * Directory (repo-relative) -> Set of crate directories that compile files
 * from it in: `include_str!`, `include_bytes!` and `include!`, with a literal
 * path or `concat!(env!("CARGO_MANIFEST_DIR"), "...")`. runtime/c is compiled
 * into the C backend this way, so a change there is a change to that crate --
 * and a new file beside the included ones is owed the same, which is why the
 * key is the directory.
 */
export function embedded() {
  return once("embedded", () => {
    const map = new Map();
    const all = crates();
    if (!all) return map;
    let text = "";
    try {
      text = execFileSync("git", ["grep", "-nE", "include(_str|_bytes)?!|CARGO_MANIFEST_DIR\"\\),", "--", "*.rs"], { cwd: TREE, encoding: "utf8", maxBuffer: 1 << 26 });
    } catch {
      return map;
    }
    for (const line of text.split("\n")) {
      const m = /^([^:]+):\d+:(.*)$/.exec(line);
      if (!m) continue;
      const [, file, src] = m;
      const crate = crateOf(file);
      if (!crate) continue;
      const targets = [
        ...[...src.matchAll(/include(?:_str|_bytes)?!\(\s*"([^"]+)"/g)].map((x) => resolve(TREE, dirname(file), x[1])),
        ...[...src.matchAll(/env!\("CARGO_MANIFEST_DIR"\),\s*"([^"]+)"/g)].map((x) => resolve(TREE, crate, x[1].replace(/^\//, ""))),
      ];
      for (const t of targets) {
        const dir = dirname(rel(t));
        if (dir === crate || dir.startsWith(`${crate}/`) || dir.startsWith("..")) continue;
        if (!map.has(dir)) map.set(dir, new Set());
        map.get(dir).add(crate);
      }
    }
    return map;
  });
}

/**
 * What a change owes. **When unsure, owe more**: the one failure that is not
 * acceptable is a change that needs a step being judged not to owe it. So
 * every source below adds to what a path owes and none replaces another:
 *
 *   - the hand-written rules a path matches;
 *   - the crate graph: a path in a crate (or in a directory a crate compiles
 *     in, see `embedded`) owes the rules of that crate and of every crate that
 *     depends on it -- a crate's own rule adds to its dependents', never
 *     stands in for them -- and a crate in that closure with no rule owes the
 *     full gate;
 *   - the corpora: a path inside a gated program's directory (by its path, so
 *     a deleted or renamed one counts) or named by its tsconfig owes the steps
 *     that compile that corpus;
 *   - what each step runs (`stepInputs`).
 *
 * A path owes the full gate when a rule says so, when none of these gave it a
 * step, or when it is an instrument the step map cannot place.
 */
export function owed(changes) {
  const out = [];
  const add = (name, path, steps, extra = {}) => {
    let r = out.find((x) => x.name === name);
    if (!r) { r = { name, paths: [], steps: [], arms: [], ...extra }; out.push(r); }
    if (!r.paths.includes(path)) r.paths.push(path);
    for (const st of steps) if (!r.steps.includes(st)) r.steps.push(st);
    return r;
  };
  const full = [];
  const rulesFor = (path, added) => RULES.filter((rule) => rule.when(path, added));
  const all = crates();

  for (const { path, added = false } of changes) {
    let gave = 0;
    let settled = false;
    let unplaced = false;
    for (const rule of rulesFor(path, added)) {
      add(rule.name, path, rule.steps, { arms: rule.arms, full: rule.full });
      gave += rule.steps.length;
      if (rule.full) gave += 1;
      if (rule.settled) settled = true;
      if (rule.placedBy === "stepInputs" && covering(stepInputs(), path).size === 0) unplaced = true;
    }

    // The crate graph.
    const roots = new Set();
    const own = crateOf(path);
    if (own) roots.add(own);
    for (const c of covering(embedded(), path)) roots.add(c);
    if (!all && /\.rs$|(^|\/)Cargo\.toml$/.test(path)) unplaced = true; // no cargo here to ask
    for (const root of roots) {
      for (const dir of dependents(root)) {
        const rules = rulesFor(`${dir}/src/lib.rs`, false).filter((r) => r.steps.length || r.full);
        const via = dir === root ? path : `${path} (through ${all.get(dir).name})`;
        if (rules.length === 0) {
          full.push(`${path} (${all.get(dir).name} has no rule in owed.mjs)`);
          continue;
        }
        for (const rule of rules) {
          add(dir === root && rulesFor(path, added).includes(rule) ? rule.name : `${rule.name}, through the crate graph`, via, rule.steps, { full: rule.full });
          gave += rule.steps.length + (rule.full ? 1 : 0);
        }
      }
    }

    // The corpora, by membership and by their tsconfigs.
    const corpora = new Set(CORPORA.filter((c) => c.member.test(path)).map((c) => c.name));
    for (const c of covering(corpusInputs(), path)) corpora.add(c);
    for (const name of corpora) {
      const c = CORPORA.find((x) => x.name === name);
      add(`an input to ${name}`, path, c.steps);
      gave += c.steps.length;
    }

    // What the steps run.
    const steps = [...covering(stepInputs(), path)];
    if (steps.length) {
      add("an input to what a gate step runs", path, steps);
      gave += steps.length;
    }

    if (unplaced) full.push(`${path} (an instrument no step's scripts were found to run)`);
    else if (gave === 0 && !settled) full.push(path);
  }

  if (full.length) {
    out.push({ name: "owes the full gate", full: true, paths: full, steps: [], arms: [
      { kind: "hygiene", asks: "what does this path reach", run: "a rule in tooling/gate/owed.mjs, so the next change to it owes what it reaches and not everything" },
    ] });
  }
  if (changes.length > 0) out.push({ ...ALWAYS, paths: [] });
  return out;
}

/**
 * The gate steps a set of rules owes, deduplicated, `build` first and the
 * cheap always-owed ones next. A rule marked `full` owes every step.
 */
export function gateSteps(rules) {
  if (rules.length === 0) return [];
  if (rules.some((r) => r.full)) {
    const all = allSteps();
    return ["build", ...ALWAYS.steps, ...all.filter((s) => s !== "build" && !ALWAYS.steps.includes(s))];
  }
  const always = new Set(ALWAYS.steps);
  const rest = rules.flatMap((r) => r.steps).filter((s) => !always.has(s) && s !== "build");
  return ["build", ...ALWAYS.steps, ...new Set(rest)];
}

// **Seen to select before it is trusted**, on the three changes that motivated it.
function selfTest() {
  const names = (changes) => owed(changes).map((r) => r.name).join(", ");
  const example = names([{ path: "examples/is-array-of-object/tsconfig.json", added: true }, { path: "examples/is-array-of-object/src/main.ts", added: true }]);
  if (!example.includes("a new example") || example.includes("an example changed")) return `a new example: ${example}`;
  const blocked = names([{ path: "tooling/conformance/build-floor.sh", added: false }]);
  if (!blocked.includes("an instrument")) return `a change to build-floor.sh: ${blocked}`;
  const tool = names([{ path: "tooling/census/rows.ts", added: false }]);
  if (!tool.includes("an instrument")) return `a change to a TypeScript tool: ${tool}`;
  const blocker = owed([{ path: "tooling/conformance/blockers/x/src/main.ts", added: true }]);
  if (blocker.some((r) => r.name === "an instrument")) return "a blockers fixture's source read as an instrument";
  if (!blocker.find((r) => r.name === "a blockers fixture")?.steps.includes("integrity")) return "a blockers fixture does not owe integrity";
  const backend = names([{ path: "compiler/codegen/c/src/emit.rs", added: false }]);
  if (!backend.includes("the C backend") || !backend.includes("every change")) return `a backend change: ${backend}`;
  const helper = names([{ path: "runtime/c/nts_runtime.h", added: false }]);
  if (!helper.includes("a runtime helper") || !helper.includes("the C runtime")) return `a runtime header change: ${helper}`;
  if (owed([]).length !== 0) return "an empty change owed something";
  const printed = owed([{ path: "tooling/cli/src/main.rs", added: false }]).find((r) => r.name === "the printed diagnostics");
  if (!printed?.steps.includes("test262-cases") || !printed.arms.some((a) => /git grep/.test(a.run))) return "a change to the driver's printing does not owe its readers";
  const lowered = owed([{ path: "compiler/core/src/hir/lower.rs", added: false }]).find((r) => r.name === "lowering");
  if (!["test262-cases", "test262-builtins-cases", "test262-rest-cases"].every((st) => lowered.steps.includes(st))) return "a lowering change does not owe the recorded test262 sets";
  if (!lowered.steps.includes("benches")) return "a lowering change does not owe the benches corpus";
  // Its own steps first, then what the crates that link it add (the CLI, the
  // suite, the bench driver): a crate's own rule never stands in for theirs.
  const order = gateSteps(owed([{ path: "compiler/codegen/llvm/src/lib.rs", added: false }]));
  if (order.slice(0, 6).join(" ") !== "build clippy tests llvm llvm-rc assembles" || !order.includes("corpus") || !order.includes("bench-agree")) return `the LLVM backend's steps: ${order.join(" ")}`;
  // A step without its question could not say what it asks.
  for (const r of [...RULES, ALWAYS]) for (const st of r.steps) if (!ASKS[st]) return `rule "${r.name}" names gate step "${st}", which ASKS does not describe`;
  for (const st of ["build"]) if (!ASKS[st]) return `ASKS lacks "${st}"`;
  for (const st of allSteps()) if (!ASKS[st]) return `all.sh defines step "${st}", which ASKS does not describe`;
  const lowering = owed([{ path: "compiler/core/src/hir/lower.rs", added: false }]).find((r) => r.name === "lowering");
  const asked = new Set(lowering.arms.filter((a) => !a.if).map((a) => a.kind));
  if (!asked.has("answers") || !asked.has("whether")) return `a lowering change owes only ${[...asked].join(", ")}`;
  if (!lowering.arms.some((a) => /emitted-diff/.test(a.run))) return "a lowering change does not owe the emitted-C diff that tells neutral's two causes apart";
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const broken = selfTest();
  if (broken) {
    console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
    process.exit(2);
  }
  if (argv.includes("--self-test")) {
    console.log("  self-test: each change selects its arms; every gate step says what it asks; lowering owes answers, counts and the emitted-C diff; a .ts tool is an instrument and a blockers fixture owes integrity");
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
  const gate = rules.some((r) => r.full) ? "sh tooling/gate/all.sh   # the full gate" : `NTS_GATE_STEPS="${steps.join(" ")}" sh tooling/gate/all.sh`;
  const arm = (a) => `${a.if ? `if ${a.if}: ` : ""}${a.asks}\n        ${a.run}`;
  console.log(`  ${changes.length} path(s) changed in ${TREE}`);
  for (const r of rules) {
    console.log(`\n  ${r.name}${r.paths.length ? ` (${r.paths.slice(0, 3).join(", ")}${r.paths.length > 3 ? `, +${r.paths.length - 3}` : ""})` : ""}`);
    for (const a of r.arms) console.log(`    [ ] [${a.kind}] ${arm(a)}`);
    if (r.steps.length > 0) console.log(`    gate: ${r.steps.join(" ")}`);
  }
  console.log("\n  the gate steps owed, and what each asks:");
  for (const step of steps) console.log(`    ${step.padEnd(18)} [${(ASKS[step] ?? ["?"])[0]}] ${(ASKS[step] ?? ["", "(not described in ASKS)"])[1]}`);
  console.log(`  in one run:\n    ${gate}`);
  // Which questions the change owes, by kind: four instruments asking one
  // question is the failure this prints against.
  const kinds = new Map();
  for (const k of [...steps.map((st) => (ASKS[st] ?? ["?"])[0]), ...rules.flatMap((r) => r.arms.filter((a) => !a.if).map((a) => a.kind))]) kinds.set(k, (kinds.get(k) ?? 0) + 1);
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
}

// Run as a command; imported (owed.test.mjs), it only exports.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
