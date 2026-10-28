// Which checks does this change owe? Takes the change, not the author's
// reading of it, and prints the checklist.
//
//   node tooling/gate/owed.mjs                  uncommitted and untracked changes
//   node tooling/gate/owed.mjs --since <rev>    everything since <rev>, plus uncommitted
//   node tooling/gate/owed.mjs --commit <rev>   one commit's changes
//   node tooling/gate/owed.mjs --range <a>..<b> the commits after <a> up to <b>, and
//                                               nothing uncommitted: what a landing gates
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
//   - **the corpora's tsconfigs and targets**: a file a gated program's
//     tsconfig includes (`files`, `include`, `extends`, `paths`), or that a
//     target its nts.config.ts builds for brings in, is an input to the steps
//     that compile that corpus -- runtime/chromium/dom/types/*.d.ts is part of
//     three blockers fixtures, so it owes `blockers`, and `target.chromium()`
//     brings it to an interop project, so it owes `interop`;
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
// a worktree's missing corpus inputs are the gate's to name, not this script's.
// The native frontend is part of the pinned compiler binary.
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
import { existsSync, globSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preciseChange } from "./precise-changes.ts";
import { mergeRuleMetadata } from "./rule-metadata.ts";

/**
 * The tree whose change is asked about: the one the command is run from, not
 * the one this script lives in. "The repo" is two things here -- the rules
 * travel with the script, the change belongs to the worktree you stand in --
 * and every lane works in a worktree. Resolving it from the script's path
 * answered, confidently, about the shared checkout's uncommitted files. The
 * `--commit` mode reads history and could not show it.
 */
const TREE = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** Verdict machinery always gates before landing, including its verifier.
 * Tree-only changes have already passed their entire owed gate; they never
 * need the future optimistic path either. Keep this routing policy in one list. */
export const STRICT_PATHS = [
  "tooling/gate/", "tooling/lanes/", "tooling/conformance/", "tooling/census/", "tooling/differential/",
  "tooling/memory/", "tooling/licenses/", "tooling/config/", "tooling/primitives/", "tooling/jvm/", "tooling/android/",
  "results/", "compiler/frontend-tsrs/vendor.ts",
];
export const isStrictPath = path => STRICT_PATHS.some(prefix => prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix);
export const TREE_CHECKS = ["rustfmt", "format", "reformat", "records", "old-paths", "primitives", "config", "licenses", "audit"];

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
/**
 * The steps a landing does not run: the full run does, on a pin of main
 * (`tooling/census/full.ts`, plan phase 3).
 *
 * The gate grew to guard the real programs the lanes were building -- addons,
 * the profile, the runtime's integrity, interop, the device -- and every
 * landing paid for all of it, twenty-odd minutes of steps sharing a loaded
 * machine. That guards work nobody is doing while conformance drives the
 * compiler, and on 2026-10-15/16 it held main still for five hours: trains
 * halved over steps no landing in them touched. So a landing runs the core:
 * build, lint, tests, the recorded conformance rows, the programs on every
 * backend, outcomes, blockers, output validity and the representation facts.
 * These run in the full run instead, and one that goes red there is bisected
 * over the landings since the last.
 *
 * A rule whose path *is* a wide step's subject marks itself `wide`, and
 * still owes that step per landing: the N-API backend owes `addons`, a
 * runtime module its integrity, a step's own scripts that step. Moving a step
 * back into every landing is deleting it from this set.
 * Counted C/LLVM execution and allocation counts stay core: reference
 * counting is the shipping native mode, including placement/escape changes.
 */
export const WIDE = new Set([
  "integrity",
  "integrity-runtime",
  "profile",
  "definitions",
  "compile-time",
  "compile-time-rc",
  "addons",
  "interop",
  "on-device",
  "dex",
  "react-sources",
  "divergence",
  "sweep",
  "bench-agree",
]);

export const ASKS = {
  build: ["hygiene", "does it build"],
  clippy: ["hygiene", "does it lint clean"],
  tests: ["answers", "do the unit tests pass, including the runtime tables"],
  doctests: ["answers", "do the doc examples of the touched Rust crates pass"],
  audit: ["valid", "do feature and exclusion classifications cite existing authorities and suite entries"],
  format: ["hygiene", "is runtime/c formatted"],
  rustfmt: ["hygiene", "is the Rust tree formatted"],
  examples: ["answers", "does every example answer as node does, on C"],
  llvm: ["answers", "the same on LLVM"],
  "llvm-rc": ["answers", "the same on LLVM with reference counting"],
  jvm: ["answers", "the same on the JVM, whose verifier types what C (`T *`) and LLVM (`ptr`) agree on by construction"],
  dex: ["valid", "does d8 accept what the JVM backend emits"],
  "jvm-verifies": ["valid", "does the runtime's and the outcomes' JVM output load, verify and link -- the jvm step runs examples only"],
  rc: ["answers", "the same on C with reference counting, where a lifetime error shows"],
  outcomes: ["answers", "does each pinned defect still do exactly what it did"],
  "expect-ir": ["answers", "does every `// expect-ir:` representation fact in the corpora still hold, on each backend it names"],
  integrity: ["valid", "is every refusal, cut and location honest, over examples, blockers and outcomes"],
  "integrity-runtime": ["valid", "the same over the runtime"],
  definitions: ["whether", "did the runtime's reach go down, per module"],
  assembles: ["valid", "is the runtime's LLVM valid IR"],
  "c-compiles": ["valid", "does every runtime project's emitted C compile, including web-platform"],
  types: ["valid", "is the snapshot's type table consistent"],
  "bench-agree": ["answers", "does every backend build and agree on the benchmarks"],
  memory: ["answers", "does counting leak or free twice, measured by live objects"],
  "example-refusals": ["valid", "is every example's recorded refusal row still exactly what lowering prints"],
  blockers: ["valid", "does every blocker still refuse with its `// expect:` line"],
  "test262-cases": ["answers", "does every recorded test/language case still do what it did, read from the printed diagnostics"],
  "test262-builtins-cases": ["answers", "the same over test/built-ins"],
  "test262-rest-cases": ["answers", "the same over test/annexB, test/staging and test/harness"],
  "test262-jvm": ["answers", "does every recorded test262 row on the JVM still do what it did"],
  "test262-llvm": ["answers", "the same on LLVM"],
  "typescript-cases": ["answers", "does every recorded TypeScript conformance case still do what it did, on every backend"],
  // A corpus of its own, and the only step that compiles it: `any` as Erased
  // (093733f2d) left awfy-towers emitting C that clang rejects, and nothing a
  // lowering change owed pointed at it until another lane found it red.
  "benches": ["answers", "does every benchmarks/cases program still emit C that compiles and runs"],
  addons: ["valid", "does each runtime module build, load and publish something"],
  "compile-time": ["hygiene", "did NoGC lowering exceed its calibrated instruction budget (perf from exec)"],
  "compile-time-rc": ["hygiene", "did RC lowering exceed its calibrated instruction budget (perf from exec)"],
  profile: ["whether", "does runtime/node emit without a panic, under the refusal ceiling, above the definition floor"],
  interop: ["answers", "does every interop project build the way its README says and run"],
  divergence: ["valid", "do node's divergence instruments still hold"],
  sweep: ["answers", "does the value-kind cross-product agree on C"],
  corpus: ["valid", "does the recorded core population finish without frontend, HIR, compiler or backend failures"],
  "on-device": ["answers", "do the bench cases agree on java and dalvikvm, on a device"],
  test262: ["valid", "is the test262 pin reachable, the inventory and the features audit current"],
  config: ["valid", "are the nts.config.ts files coherent"],
  "react-sources": ["valid", "do the vendored React sources match their manifest"],
  "licenses": ["valid", "do full compiler dependency notices match the locked closure"],
  "frontend-tsrs": ["valid", "do native sources, adapter tests and every program's reachable capture graph pass"],
  primitives: ["valid", "does every name docs/primitives.md cites exist"],
  records: ["hygiene", "is every record number used once"],
  "old-paths": ["hygiene", "does anything sit or point where the corpora used to be"],
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
    // This is a standalone validation driver, not an input to a gate step.
    // Its command policy is covered by the tracked-launch tooling audit;
    // execute its provider witness explicitly when changing the driver.
    name: "the standalone ICU validation driver",
    when: p => p === "runtime/ecmascript/tools/icu.ts",
    steps: ["tooling", "licenses"],
    arms: [
      { kind: "answers", asks: "does the changed ICU witness still validate", run: "NTS_BIN=<pinned compiler> node runtime/ecmascript/tools/icu.ts --string-case; run other affected witness modes explicitly" },
    ],
  },
  {
    name: "compiler dependency notices",
    when: (p) => p === "Cargo.lock" || p === "NOTICE" || /(^|\/)Cargo\.toml$/.test(p) || /^(third_party|licenses|tooling\/licenses)\//.test(p),
    steps: ["licenses"],
    arms: [],
  },
  {
    name: "the native TypeScript frontend",
    when: (p) => /^(third_party\/tsrs|compiler\/frontend-ts(?:rs)?|compiler\/semantic-schema)\//.test(p),
    steps: ["frontend-tsrs"],
    arms: [],
  },
  {
    name: "workspace dependency and toolchain inputs",
    when: (p) => /^(Cargo\.(toml|lock)|rust-toolchain\.toml)$/.test(p),
    // Preserve the full core gate these shared inputs already owed.
    full: true,
    steps: ["frontend-tsrs"],
    arms: [],
  },
  {
    name: "a new example",
    when: (p, added) => added && /^tests\/programs\/[^/]+\/tsconfig\.json$/.test(p),
    steps: ["examples", "llvm", "llvm-rc", "jvm", "rc", "integrity"],
    arms: [
      { kind: "answers", asks: "does it agree on every backend -- by hand, because the differential reads the shared tree and cannot see an example not yet in it", run: "node tooling/differential/agree.mjs <after> --only=<example>   # and NTS_BACKEND=llvm, llvm+NTS_RC=1, jvm, NTS_RC=1" },
      { kind: "answers", asks: "does it guard the change: it must not agree on the binary before", run: "node tooling/differential/agree.mjs <before> <after> --only=<example>" },
      { kind: "hygiene", asks: "can a pinned gate see it", run: "commit it before a pinned gate run: a worktree gate cannot see an uncommitted example" },
    ],
  },
  {
    name: "an example changed",
    when: (p, added) => !added && /^tests\/(programs\/[^/]+|interop|gjs|workspace)\//.test(p),
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
    steps: ["expect-ir", "examples", "llvm", "llvm-rc", "jvm", "rc", "outcomes", "integrity", "integrity-runtime", "definitions", "example-refusals", "blockers", "test262-cases", "test262-builtins-cases", "test262-rest-cases", "test262-jvm", "test262-llvm", "typescript-cases", "benches", "jvm-verifies", "compile-time", "addons", "profile", "assembles", "memory", "bench-agree", "corpus", "dex"],
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
    // memory/run.sh emits C with --rc and runs it through clang; it never
    // selects the LLVM backend.
    steps: ["examples", "rc", "memory", "outcomes", "c-compiles", "test262-cases", "test262-builtins-cases", "test262-rest-cases", "typescript-cases", "benches"],
    arms: [COMPARE[0], COMPARE[2]],
  },
  {
    name: "the LLVM backend",
    when: (p) => /^compiler\/codegen\/llvm\//.test(p),
    // Every step that selects it through the CLI (see SELECTED_BY_THE_CLI):
    // the differential runs, the IR check, benches.sh's emit-llvm, the interop
    // projects built with `backend: "llvm"`, and outcomes marked `// backend: llvm`.
    steps: ["llvm", "llvm-rc", "assembles", "benches", "interop", "outcomes", "test262-llvm", "typescript-cases"],
    arms: [{ kind: "answers", asks: "which code is emitted, on LLVM", run: "NTS_BACKEND=llvm node tooling/differential/agree.mjs <before> <after>; NTS_RC=1 ..." }],
  },
  {
    name: "the JVM backend",
    when: (p) => /^compiler\/codegen\/jvm\//.test(p),
    // Every step that selects it through the CLI (see SELECTED_BY_THE_CLI):
    // emit-jvm in the differential, d8, the verifier, bench-agree (JVM by
    // default), benches.sh, the device, the JVM interop projects (java-from-ts,
    // ts-from-java, android-shape), and outcomes marked `// backend: jvm`.
    steps: ["jvm", "dex", "jvm-verifies", "bench-agree", "benches", "on-device", "interop", "outcomes", "test262-jvm", "typescript-cases"],
    interop: () => interopBuiltWith("jvm"),
    arms: [
      { kind: "answers", asks: "which code is emitted, on the JVM", run: "NTS_BACKEND=jvm node tooling/differential/agree.mjs <before> <after>" },
      { kind: "valid", asks: "does the runtime's JVM output pass the verifier -- the jvm step runs examples only", run: "NTS_BIN=<after> node tooling/conformance/jvm-verifies.ts" },
    ],
  },
  {
    name: "the frontend or the snapshot schema",
    when: (p) => /^compiler\/(frontend-ts|semantic-schema)\//.test(p),
    steps: ["types", "examples", "expect-ir", "test262-cases", "test262-builtins-cases", "test262-rest-cases", "test262-jvm", "test262-llvm", "typescript-cases"],
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
    steps: ["format", "examples", "rc", "llvm", "llvm-rc", "memory", "assembles"],
    arms: [
      { kind: "hygiene", asks: "is the binary testing the new runtime", run: "rebuild nts: runtime/c is include_str!-ed, so an old binary tests the old runtime" },
      COMPARE[0],
      COMPARE[2],
    ],
  },
  {
    name: "a runtime module",
    wide: true,
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
    steps: ["outcomes", "integrity", "example-refusals", "blockers", "test262-cases", "test262-builtins-cases", "test262-rest-cases", "test262-jvm", "test262-llvm", "typescript-cases"],
    arms: [
      { if: "it changes what a printed diagnostic line says or how it is shaped", kind: "valid", asks: "who parses this line: every reader of it, widened to accept both shapes before the shape changes", run: "git grep -nE 'TS(.d|.0-9)|refused:|not (rendered|emitted):' -- '*.mjs' '*.sh' '*.ts' ':!*.d.ts'   # `.` is the \\ of a JS reader's \\d and the [ of a shell one's [0-9]" },
    ],
  },
  {
    name: "an instrument",
    // `.ts` since the lanes' tools became TypeScript (2026-09-29): until then
    // this matched none of them, and no instrument change owed a self-test.
    // The fixture trees are programs, not instruments, and have rules below.
    when: (p) => /^tooling\/(conformance|census|differential|gate)\/.*\.(mjs|ts|sh)$/.test(p)
      && p !== "tooling/census/fixtures/resident-worker.ts",
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
    // Every step, the wide ones too: it runs them all, the full run's among them.
    full: true,
    wide: true,
    steps: [],
    arms: [
      { kind: "valid", asks: "does it parse, and do the touched steps run", run: "sh -n tooling/gate/all.sh; node --test tooling/gate/*.test.mjs; then the steps, from a worktree" },
      { kind: "hygiene", asks: "do the lanes know", run: "announce it; never edit it while a run from this tree is executing" },
    ],
  },
  {
    name: "an outcomes fixture",
    when: (p) => /^tests\/outcomes\//.test(p),
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
    when: (p) => /^tests\/refusals\//.test(p),
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
    wide: true,
    when: (p) => /^compiler\/codegen\/napi\//.test(p),
    steps: ["addons", "profile", "divergence"],
    arms: [],
  },
  {
    name: "the backends' common code",
    when: (p) => /^compiler\/codegen\/common\//.test(p),
    steps: ["examples", "llvm", "jvm", "rc", "llvm-rc", "assembles", "jvm-verifies", "dex", "bench-agree", "benches", "test262-jvm", "test262-llvm", "typescript-cases"],
    arms: [],
  },
  {
    // The JVM's own wide steps, per landing for what the JVM itself is made
    // of -- the lane's choice when the wide steps moved to the full run
    // (2026-10-16), each for a hole nothing core covers: d8 rejects class names
    // the verifier accepts (`__@kCount@2`); bench-agree answers the benchmarks'
    // hostile pools, which benches only compiles (absences' u32 remainder); and
    // the interop projects call foreign ABIs and callbacks that loading a
    // class never runs. Matched here rather than inherited through the crate
    // graph, which carries no `wide`. on-device stays in the full run.
    name: "the JVM's own wide steps",
    when: (p) => /^(compiler\/codegen\/jvm|compiler\/jvm-emitter|runtime\/jvm)\//.test(p),
    wide: true,
    steps: ["dex", "bench-agree", "interop"],
    interop: () => interopBuiltWith("jvm"),
    arms: [],
  },
  {
    // The JVM runtime: the jar every emitted class links against. Its direct
    // rule was the lane's wide trio above; jvm and jvm-verifies reached it only
    // indirectly, through the JVM backend's embedded jar and crate graph. This
    // states that obligation where the runtime is, and adds the JVM's test262
    // rows, which nothing owed before.
    name: "the JVM runtime",
    when: (p) => /^runtime\/jvm\//.test(p),
    steps: ["jvm", "jvm-verifies", "test262-jvm"],
    arms: [],
  },
  {
    // Tool-written measurements are outputs. Recorded conformance baselines
    // still owe their readers through the rules and derived maps below.
    name: "tool-written results",
    when: p => p.startsWith("results/"),
    settled: true,
    steps: TREE_CHECKS,
    arms: [],
  },
  {
    // A record is what its step holds a run to: re-recording one owes that
    // step on that backend, not the full gate an unmatched path would. C's
    // records need no rule -- all.sh names each one, so `stepInputs` places
    // them -- but test262_backend builds these paths from its argument.
    name: "a JVM test262 record",
    when: (p) => /^results\/test262\/jvm\/[^/]+\.tsv$/.test(p),
    steps: ["test262-jvm"],
    arms: [],
  },
  {
    name: "an LLVM test262 record",
    when: (p) => /^results\/test262\/llvm\/[^/]+\.tsv$/.test(p),
    steps: ["test262-llvm"],
    arms: [],
  },
  {
    // A case and its records: typescript_cases runs every backend's, by paths
    // it builds from the backend's name. A pending case (one node cannot be
    // the oracle for yet) runs nowhere, and is here so it owes no more.
    name: "the TypeScript conformance suite",
    when: (p) => /^(tests\/typescript|tests\/typescript-pending|results\/typescript)\//.test(p) || p === "tooling/census/suites/typescript.ts",
    steps: ["typescript-cases"],
    arms: [{ kind: "answers", asks: "does node, the oracle, pass a new case first", run: "node tooling/census/conformance262.ts --suite typescript --under tests/typescript/<family>" }],
  },
  {
    name: "the JVM class writer",
    when: (p) => /^compiler\/jvm-emitter\//.test(p),
    steps: ["jvm", "dex", "jvm-verifies", "bench-agree", "on-device", "test262-jvm"],
    interop: () => interopBuiltWith("jvm"),
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
    steps: ["interop", "config", "addons", "profile", "dex", "bench-agree", "examples", "llvm", "jvm", "rc", "expect-ir", "test262-jvm", "test262-llvm", "typescript-cases"],
    arms: [],
  },
  {
    // Run by `tests/interop/{java-from-ts,android-shape}/build.sh` and
    // nothing else, which the `interop` step runs. Before this rule it owed the
    // full gate.
    name: "the refused.ts claim checker",
    when: (p) => p === "tooling/jvm/check-refusals.sh",
    steps: ["interop"],
    interop: () => interopBuiltWith("jvm"),
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
    steps: ["corpus", "test262", "test262-cases", "test262-builtins-cases", "test262-rest-cases", "test262-jvm", "test262-llvm", "typescript-cases"],
    arms: [],
  },
  {
    // Read by two steps and by people; no program compiles a page of it.
    name: "documentation",
    when: (p) => /\.md$/.test(p) && !/^(tests|benchmarks|tooling\/(conformance|memory)|runtime)\//.test(p),
    steps: ["records", "primitives"],
    arms: [],
  },
  {
    // Only worker-memory.test.ts executes this synthetic compiler. The
    // production census uses attempt262-worker.ts, not this allocation control.
    name: "the resident worker control fixture",
    when: (p) => p === "tooling/census/fixtures/resident-worker.ts",
    steps: ["tooling"],
    arms: [],
  },
  {
    name: "the native counter control fixture",
    when: (p) => p === "tooling/gate/fixtures/counter-thread.c",
    steps: ["tooling"],
    arms: [],
  },
  {
    name: "the compile-time baselines",
    wide: true,
    when: (p) => /^tooling\/gate\/compile-times(?:-rc)?\.tsv$/.test(p) || /^results\/compile-counter(?:-rc)?-calibration\.json$/.test(p),
    steps: ["compile-time"],
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
    // The Chromium lane's own files: the Blink build, its harnesses and the
    // bindings generator (tooling/chromium), and what only that build compiles
    // -- the app host, the Blink adapter, the embedder probe, the apps, the
    // tests and benchmarks, their docs (runtime/chromium). No gate step runs
    // any of it (a file a step does run still owes that step, through the step
    // map). A gate step that starts reading a file here must enter the step
    // map too, or this rule hides it: settling the path is a claim that
    // nothing in the gate reaches it. What a gated program does reach is
    // charged as its own path, through the corpora: the DOM surface and its
    // native half (runtime/chromium/dom) that `target.chromium()` brings to an
    // interop project owe `interop`, and the declarations the blockers
    // fixtures' tsconfigs name owe `blockers` and `integrity`. The rest is
    // checked by tooling/chromium/verify.ts (both backends, against the V8
    // oracle).
    name: "the Chromium lane",
    wide: true,
    when: (p) => /^(tooling|runtime)\/chromium\//.test(p),
    settled: true,
    steps: [],
    arms: [{ kind: "answers", asks: "does the lane still agree with V8 on both backends", run: "node tooling/chromium/verify.ts: the bindings current, both backends staged, built and smoked against the V8 oracle, and every example app built and checked" }],
  },
  {
    // The node lane's harness: the runner node's own tests go through, its
    // stand-ins for their `test/common`, and the instruments over what the
    // modules publish. These are the lane's `tooling/` paths in
    // tooling/lanes/lanes.json, so a file the lane takes on is settled with
    // the rest. No gate step runs them. One that does still owes that step
    // through the step map (build.sh owes `addons`). A gate step that starts
    // reading one must enter that map too, or this rule hides it. What the
    // harness says is checked where it runs: the compiled axis against its
    // floor, and the web platform's own suite.
    name: "the node lane's harness",
    wide: true,
    when: (p) => nodeHarness(p),
    settled: true,
    steps: [],
    arms: [
      { kind: "answers", asks: "what node's own tests say of each compiled module", run: "node tooling/conformance/compiled-axis-floor.mjs   # lane-local, ~16 min" },
      { if: "it touches the web platform's harness", kind: "answers", asks: "does every web platform test file still run and pass", run: "sh tooling/conformance/web-platform/check.sh" },
    ],
  },
  {
    name: "the gate's own tests",
    when: (p) => /^tooling\/gate\/([^/]+\.test\.mjs|owed\.mjs)$/.test(p),
    steps: ["tooling"],
    arms: [],
  },
  {
    // `pinned.sh` builds every gate tree with it, the full run's too, so it
    // owes every step, as the runner does.
    name: "the gate trees' inputs",
    when: (p) => p === "tooling/lanes/inputs.sh",
    full: true,
    wide: true,
    steps: [],
    arms: [],
  },
  {
    // The landing and lane tools. No gate step runs `land.ts` or `lane.ts`:
    // they run the gate rather than the other way round, so a change to one
    // is checked by running it -- a dry run names what a range owes and
    // touches nothing.
    name: "the landing tools",
    when: (p) => /^tooling\/lanes\/(land|lane|verification-ledger)\.ts$/.test(p),
    settled: true,
    steps: [],
    arms: [{ kind: "answers", asks: "does a dry run still name what a range owes", run: "node tooling/lanes/land.ts HEAD --dry-run; node tooling/lanes/lane.ts status" }],
  },
  {
    // Read by `land.ts` (a platform lane's `not_run`) and by the gate's own
    // rules, so a change to it owes the gate's own tests.
    name: "the lane registry",
    when: (p) => p === "tooling/lanes/lanes.json",
    steps: ["tooling"],
    arms: [],
  },
];

/** The node lane's `tooling/` paths in tooling/lanes/lanes.json: a file, or a directory and what is under it. */
function nodeHarness(path) {
  const owns = once("nodeHarness", () =>
    (JSON.parse(readFileSync(join(TREE, "tooling/lanes/lanes.json"), "utf8")).lanes.node?.owns ?? []).filter((p) => p.startsWith("tooling/")));
  return owns.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/** Every change, whatever it touched: the gate's first two steps. */
const ALWAYS = { name: "every change", when: () => true, steps: ["clippy", "tests", "rustfmt", "old-paths"], arms: [] };

/**
 * `{ path, added, deleted }` for the change asked about. A rename or copy is
 * both of its paths: the old one deleted (moving a fixture out of blockers/
 * still owes blockers) and the new one added (moving one into tests/programs/ is a
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

export function changedPaths(argv) {
  const git = (...args) => execFileSync("git", args, { cwd: TREE, encoding: "utf8" });
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const commit = at("--commit");
  if (commit) return contentChanges(parseNameStatus(git("diff", "--name-status", "-M", `${commit}^`, commit)), `${commit}^`, commit);
  // Two commits and nothing else: no working tree and no untracked files. What
  // a landing gates is a commit, and a tree's uncommitted or linked files (a
  // symlinked submodule, a node_modules link) are not part of it -- read from
  // a worktree they made every change owe the full gate.
  const range = at("--range");
  if (range) {
    const [from, to] = range.split("..");
    if (!from || !to) throw new Error(`--range wants A..B, got ${range}`);
    return contentChanges(parseNameStatus(git("diff", "--name-status", "-M", from, to)), from, to);
  }
  const since = at("--since");
  const tracked = parseNameStatus(git("diff", "--name-status", "-M", since ?? "HEAD"));
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((path) => ({ path, added: true, deleted: false }));
  return [...contentChanges(tracked, since ?? "HEAD", null), ...untracked];
}

/** Compare the requested Git blobs, never today's bytes for a historical range. */
function contentChanges(changes, from, to) {
  const git = (...args) => execFileSync("git", args, { cwd: TREE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 << 20 });
  return changes.map(change => {
    if (change.added || change.deleted) return change;
    try {
      const mode = rev => git("ls-tree", rev, "--", change.path).split(" ")[0];
      const oldMode = mode(from);
      const file = to ? null : lstatSync(join(TREE, change.path));
      const newMode = to ? mode(to) : file.isFile() ? file.mode & 0o111 ? "100755" : "100644" : "other";
      if (!["100644", "100755"].includes(oldMode) || oldMode !== newMode) return change;
      return { ...change, sameMode: true, before: git("show", `${from}:${change.path}`), after: to ? git("show", `${to}:${change.path}`) : readFileSync(join(TREE, change.path), "utf8") };
    } catch { return change; }
  });
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

/** Production/build dependency reach; workspace tests cover dev dependencies. */
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
      out.set(dir, { name: p.name, doctests: p.targets.some(t => t.doctest && t.kind.some(k => ["lib", "rlib", "dylib", "proc-macro"].includes(k))), deps: [...new Set(p.dependencies.filter((d) => d.kind !== "dev" && d.path && byName.has(d.name)).map((d) => byName.get(d.name)))], users: [] });
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

/**
 * The nearest directory above `path` with a Cargo.toml, the workspace root's
 * aside: a crate found without asking cargo, for when cargo cannot answer.
 */
export function cargoDirOf(path) {
  for (let d = dirname(path); d !== "." && d !== "" && d !== "/"; d = dirname(d)) {
    if (existsSync(join(TREE, d, "Cargo.toml"))) return d;
  }
  return null;
}

/**
 * **The CLI runs a backend only when a command selects it.** `nts` links every
 * backend, and `emit-llvm`, `emit-jvm`, `--napi`, a config's
 * `backend` or NTS_BACKEND decide which one runs; every other command never
 * enters it. So a change inside one of these backends changes what the CLI
 * does on exactly the steps that select that backend -- which the backend's
 * own rule lists -- and not on everything the CLI's rule owes.
 *
 * The C backend is not here: it is what every one of those runs by default.
 * The other crates that link a backend (the differential, the bench driver,
 * the suite) call into it in their own code, and keep their reach.
 */
const SELECTED_BY_THE_CLI = new Set(["compiler/codegen/llvm", "compiler/codegen/jvm", "compiler/codegen/napi", "compiler/jvm-emitter"]);

/**
 * `dir` and every crate that depends on it, directly or not -- except the CLI
 * when `dir` is a backend it selects (SELECTED_BY_THE_CLI), by whichever
 * crate the graph reaches it: the CLI also runs the differential, which runs
 * the JVM and LLVM backends only for the commands that ask for them.
 */
export function dependents(dir) {
  const all = crates();
  const selected = SELECTED_BY_THE_CLI.has(dir);
  const seen = new Set([dir]);
  const queue = [dir];
  while (queue.length) {
    for (const u of all.get(queue.shift())?.users ?? []) {
      const name = all.get(u)?.name;
      if (seen.has(u) || (selected && name === "nts-cli")) continue;
      seen.add(u);
      queue.push(u);
    }
  }
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
  { name: "the examples", member: /^tests\/(programs\/[^/]+|gjs|workspace)\//, dirs: () => [...kids("tests/programs"), "tests/gjs", "tests/workspace"], steps: ["examples", "expect-ir", "llvm", "llvm-rc", "jvm", "rc", "integrity", "example-refusals", "dex"] },
  { name: "the interop projects", wide: true, member: /^tests\/interop\/[^/]+\//, dirs: () => kids("tests/interop"), steps: ["interop"] },
  { name: "the blockers", member: /^tests\/refusals\/[^/]+\//, dirs: () => kids("tests/refusals"), steps: ["blockers", "integrity"] },
  { name: "the outcomes", member: /^tests\/outcomes\/[^/]+\//, dirs: () => kids("tests/outcomes"), steps: ["outcomes", "integrity", "jvm-verifies"] },
  { name: "the runtime modules", wide: true, member: /^runtime\/(node\/[^/]+|web-platform)\//, dirs: () => [...kids("runtime/node"), "runtime/web-platform"], steps: ["definitions", "integrity-runtime", "compile-time", "assembles", "c-compiles", "addons", "profile", "types", "jvm-verifies", "divergence"] },
  { name: "the bench cases", wide: true, member: /^benchmarks\/cases\/[^/]+\//, dirs: () => kids("benchmarks/cases"), steps: ["benches", "bench-agree", "dex", "expect-ir"] },
  { name: "the memory cases", wide: true, member: /^tests\/memory\/[^/]+\//, dirs: () => kids("tests/memory"), steps: ["memory"] },
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

/**
 * Target constructor name -> the files it brings into every program built for
 * it, repo-relative: the `runtimeFile("...")` calls in that constructor in
 * tooling/config/src/target.ts, its `surface` and `native`. A program reaches
 * them through its nts.config.ts, and no tsconfig names them:
 * tests/interop/chromium-surface builds on Chromium's DOM surface and links
 * its native half with neither in its tsconfig.json.
 */
export function targetFiles() {
  return once("targetFiles", () => {
    const map = new Map();
    let name = null;
    for (const line of readFileSync(join(TREE, "tooling/config/src/target.ts"), "utf8").split("\n")) {
      // The constructors are the members of `export const target = {`.
      const head = /^  (\w+): \(/.exec(line);
      if (head) map.set((name = head[1]), []);
      else if (line.startsWith("}")) name = null;
      for (const [, path] of line.matchAll(/runtimeFile\("([^"]+)"\)/g)) if (name) map.get(name).push(`runtime/${path}`);
    }
    return map;
  });
}

/** What the targets a program's nts.config.ts builds for bring into it (`targetFiles`). */
function configTargetInputs(dir) {
  const config = join(TREE, dir, "nts.config.ts");
  if (!existsSync(config)) return [];
  const files = targetFiles();
  return [...readFileSync(config, "utf8").matchAll(/\btarget\.(\w+)\(/g)].flatMap(([, name]) => files.get(name) ?? []);
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
/**
 * interop project -> what its build reads, as `corpusInputs` maps a corpus:
 * its directory, its tsconfig's inputs and its config's target files, so a
 * path owes the projects that read it and no other. A path no project reads
 * maps to none, and owes every project.
 */
export function interopInputs() {
  return once("interop-inputs", () => {
    const map = new Map();
    const add = (input, project) => { if (!map.has(input)) map.set(input, new Set()); map.get(input).add(project); };
    for (const dir of kids("tests/interop")) {
      if (!existsSync(join(TREE, dir, "build.sh"))) continue;
      const project = dir.split("/")[2];
      add(dir, project);
      const config = existsSync(join(TREE, dir, "tsconfig.json")) ? `${dir}/tsconfig.json` : null;
      for (const input of config ? tsconfigInputs(config) : []) if (input !== "" && input !== ".") add(input, project);
      for (const input of configTargetInputs(dir)) add(input, project);
    }
    return map;
  });
}

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
        for (const input of configTargetInputs(dir)) add(input, c.name);
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
    const PATH = /(?:^|[\s"'=(/$])((?:tooling|runtime|tests|benchmarks|results|compiler|build|docs)(?:\/[A-Za-z0-9_.@+*-]*[A-Za-z0-9_@+*-])+)/g;
    // Code, not prose: a comment that mentions a path does not read it. A
    // directory of two segments (`tooling/conformance`, from a path built
    // with a variable) is too wide to mean anything and is dropped.
    const code = (body) => body.split("\n").filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join("\n");
    // A data tree is named wide on purpose -- `join(repo, "examples")` walks
    // every example for its nts.config.ts -- so a bare quoted top directory of
    // programs, or a short path into one, is kept.
    const DATA = /^(tests|benchmarks|runtime|docs)(\/|$)/;
    // A glob names the files it matches, not the directory it sits in:
    // `node --test tooling/gate/*.test.mjs` reads each test file, and cut back
    // to `tooling/gate` it was a directory of two segments, dropped below as
    // too wide -- so no step was found to run the gate's own tests, and a
    // change to one owed the full gate.
    const expand = (p) => {
      if (!/[*?]/.test(p)) return [p];
      const files = globSync(p, { cwd: TREE });
      return files.length > 0 ? files : [p.replace(/\/[^/]*[*?].*$/, "")];
    };
    const named = (body) => [
      ...[...code(body).matchAll(PATH)]
        .flatMap((m) => expand(m[1].replace(/\/$/, "")))
        .filter((p) => p.split("/").length > 2 || /\.[a-z]+$/.test(p) || DATA.test(p)),
      ...[...code(body).matchAll(/["'](benchmarks)["']/g)].map((m) => m[1]),
    ];
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
        // branches.test models build-output paths and writes them only in
        // private fixture repos. Those strings do not read checked-in bench
        // cells; keep real imports/beside-file dependencies unchanged.
        const referenced = named(body).filter(p => !(input === "tooling/lanes/branches.test.ts" && p.startsWith("results/benchmarks/")));
        queue.push(...referenced, ...imports(input, body), ...beside);
      }
    }
    // **Hand-overs through the runner.** run.mjs gives one step another's
    // output (`if (step.name === "definitions" && plan.includes("integrity-
    // runtime")) e.NTS_DEFINITIONS_FROM = ...`): definitions and compile-time
    // read what integrity --runtime kept, and addons what profile emitted. So
    // whatever the giving step runs, the taking step runs too.
    const runner = readFileSync(join(TREE, "tooling/gate/run.mjs"), "utf8");
    for (const m of runner.matchAll(/step\.name === "([a-z0-9-]+)" && plan\.includes\("([a-z0-9-]+)"\)\)\s*e\.NTS_[A-Z_]+\s*=/g)) {
      const [, taker, giver] = m;
      for (const steps of map.values()) if (steps.has(giver)) steps.add(taker);
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
      // By Cargo.toml when cargo cannot be asked: the directory still has to be
      // known to be compiled in, so owed() can send it to the full gate.
      const crate = crateOf(file) ?? cargoDirOf(file);
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
  // `projects`: the interop projects these steps owe, when the source can
  // say; otherwise every one (see `interopOwed`).
  const add = (name, path, steps, extra = {}, projects = null) => {
    let r = out.find((x) => x.name === name);
    if (!r) { r = { name, paths: [], steps: [], arms: [], precise: true }; out.push(r); }
    Object.assign(r, mergeRuleMetadata(r, extra));
    if (!r.paths.includes(path)) r.paths.push(path);
    // Both preparation arms have exactly the same subjects. Centralising the
    // implication keeps future compile-time rules from silently missing RC.
    for (const st of steps.flatMap(st => st === "compile-time" ? [st, "compile-time-rc"] : [st])) {
      if (!r.steps.includes(st)) r.steps.push(st);
    }
    if (steps.includes("interop")) {
      r.interop = !projects || r.interop === "all" ? "all" : [...new Set([...(r.interop ?? []), ...projects])];
    }
    return r;
  };
  const full = [];
  const rulesFor = (path, added) => RULES.filter((rule) => rule.when(path, added));
  const all = crates();

  let ordinary = false;
  for (const change of changes) {
    const { path, added = false } = change;
    if (path.startsWith("results/") && all) {
      const readers = new Set([...covering(stepInputs(), path)]);
      for (const name of covering(corpusInputs(), path)) for (const step of CORPORA.find(c => c.name === name).steps) readers.add(step);
      for (const rule of rulesFor(path, added)) for (const step of rule.steps) readers.add(step);
      const fullReader = rulesFor(path, added).some(rule => rule.full);
      // A future compiled include or corpus input keeps its full ordinary
      // reach. Only an output with no execution reader takes the fast lane.
      if (!fullReader && !crateOf(path) && !covering(embedded(), path).size && [...readers].every(step => TREE_CHECKS.includes(step))) {
        add("tool-written results", path, TREE_CHECKS, {precise:true});
        continue;
      }
    }
    let precise = preciseChange(change);
    const ownCrate = crateOf(path);
    // include_str!/build inputs observe prose bytes too, not just tokens.
    if (precise === "comments" && (covering(embedded(), path).size || (path.endsWith(".rs") && !ownCrate))) precise = null;
    if (precise) {
      const records = ["test262-cases", "test262-builtins-cases", "test262-rest-cases", "test262-jvm", "test262-llvm", "typescript-cases"];
      // A changed/removed feature also owes the full metadata selection: it
      // can leave an upstream feature unclassified. Prose cannot do that.
      const steps = precise === "classification meaning" ? ["audit", "test262", ...records] : [...TREE_CHECKS];
      const row = add(precise, path, steps, { precise: true });
      if (precise === "comments" && path.endsWith(".rs") && all?.get(ownCrate)?.doctests) {
        const name = all?.get(ownCrate)?.name;
        if (!name) throw new Error(`no crate name for ${path}`);
        row.steps.push("doctests");
        row.doctests = [...new Set([...(row.doctests ?? []), name])];
      }
      if (precise === "classification meaning") ordinary = true;
      continue;
    }
    ordinary = true;
    let gave = 0;
    let settled = false;
    let unplaced = null; // why the path owes the full gate, when it does
    let unrun = false; // an instrument no step's scripts were found to run
    for (const rule of rulesFor(path, added)) {
      add(rule.name, path, rule.steps, { arms: rule.arms, full: rule.full, wide: rule.wide }, rule.interop?.());
      gave += rule.steps.length;
      if (rule.full) gave += 1;
      if (rule.settled) settled = true;
      if (rule.placedBy === "stepInputs" && covering(stepInputs(), path).size === 0) unrun = true;
    }
    // A settled rule is the claim that no gate step reaches the path, which is
    // the question an unplaced instrument leaves open.
    if (unrun && !settled) unplaced = "an instrument no step's scripts were found to run";

    // The crate graph.
    const roots = new Set();
    const own = crateOf(path);
    if (own) roots.add(own);
    for (const c of covering(embedded(), path)) roots.add(c);
    // No cargo to ask for the graph: any path in a crate, or in a directory a
    // crate compiles in, owes the full gate.
    if (!all && (/\.rs$|(^|\/)Cargo\.toml$/.test(path) || cargoDirOf(path) || roots.size)) unplaced = "compiled into a crate, and cargo metadata could not say which crates depend on it";
    for (const root of all ? roots : []) {
      for (const dir of dependents(root)) {
        const rules = rulesFor(`${dir}/src/lib.rs`, false).filter((r) => r.steps.length || r.full);
        const via = dir === root ? path : `${path} (through ${all.get(dir).name})`;
        if (rules.length === 0) {
          full.push(`${path} (${all.get(dir).name} has no rule in owed.mjs)`);
          continue;
        }
        for (const rule of rules) {
          add(dir === root && rulesFor(path, added).includes(rule) ? rule.name : `${rule.name}, through the crate graph`, via, rule.steps, { full: rule.full }, rule.interop?.());
          gave += rule.steps.length + (rule.full ? 1 : 0);
        }
      }
    }

    // The corpora, by membership and by their tsconfigs.
    // The interop projects whose build reads this path, when any does: what
    // it owes of `interop` (a change in one project builds that project).
    const readers = [...covering(interopInputs(), path)];
    const projects = readers.length > 0 ? readers : null;
    const corpora = new Set(CORPORA.filter((c) => c.member.test(path)).map((c) => c.name));
    for (const c of covering(corpusInputs(), path)) corpora.add(c);
    for (const name of corpora) {
      const c = CORPORA.find((x) => x.name === name);
      add(`an input to ${name}`, path, c.steps, { wide: c.wide }, projects);
      gave += c.steps.length;
    }

    // What the steps run.
    const steps = [...covering(stepInputs(), path)];
    if (steps.length) {
      // A step's own scripts owe that step, wide or not; the corpora it reads
      // are owed by their own rules, and a fixture's wide steps run in the
      // full run like any other change's.
      add("an input to what a gate step runs", path, steps, { wide: /^tooling\//.test(path) }, projects);
      gave += steps.length;
    }

    if (unplaced) full.push(`${path} (${unplaced})`);
    else if (gave === 0 && !settled) full.push(path);
  }

  if (full.length) {
    out.push({ name: "owes the full gate", full: true, paths: full, steps: [], arms: [
      { kind: "hygiene", asks: "what does this path reach", run: "a rule in tooling/gate/owed.mjs, so the next change to it owes what it reaches and not everything" },
    ] });
  }
  if (ordinary) out.push({ ...ALWAYS, paths: [] });
  return out;
}

/**
 * The gate steps a set of rules owes, deduplicated, `build` first and the
 * cheap always-owed ones next. A rule marked `full` owes every step.
 */
/**
 * The interop projects whose build reaches a backend: its build.sh or
 * nts.config.ts names it. A broad match on purpose -- a project the match
 * takes in needlessly costs a build, one it leaves out lands a change its
 * project never ran.
 */
export function interopBuiltWith(backend) {
  const words = { jvm: /jvm|android|\bdex\b|\bd8\b/i }[backend];
  if (!words) throw new Error(`interopBuiltWith: no match written for ${backend}`);
  return once(`interop-${backend}`, () => {
    const dir = join(TREE, "tests/interop");
    return readdirSync(dir).filter((name) => {
      const read = (f) => (existsSync(join(dir, name, f)) ? readFileSync(join(dir, name, f), "utf8") : "");
      return existsSync(join(dir, name, "build.sh")) && words.test(read("build.sh") + read("nts.config.ts"));
    });
  });
}

/**
 * Which interop projects the rules owe: null when they owe no `interop`,
 * "all" when any rule owing it could not narrow it (or the full gate is
 * owed), else the projects named. all.sh's interop step reads the list from
 * NTS_INTEROP_PROJECTS and builds only those.
 */
export function interopOwed(rules) {
  if (!gateSteps(rules).includes("interop")) return null;
  if (rules.some((r) => r.full)) return "all";
  const owing = rules.filter((r) => r.steps.includes("interop"));
  if (owing.some((r) => r.interop === "all" || !r.interop)) return "all";
  return [...new Set(owing.flatMap((r) => r.interop))].sort();
}

export function gateSteps(rules) {
  if (rules.length === 0) return [];
  if (rules.every(r => r.precise)) return [...new Set(rules.flatMap(r => r.steps))];
  // A wide step is a landing's only where a rule that is its subject owes it.
  const kept = new Set(rules.filter((r) => r.wide).flatMap((r) => r.steps));
  const landing = (s) => !WIDE.has(s) || kept.has(s);
  if (rules.some((r) => r.full)) {
    const all = allSteps();
    // The full gate is every core step; a rule both full and wide (the runner,
    // the gate trees' inputs) owes every step there is.
    const every = rules.some((r) => r.full && r.wide);
    return ["build", ...ALWAYS.steps, ...all.filter((s) => s !== "build" && !ALWAYS.steps.includes(s) && (every || landing(s)))];
  }
  const always = new Set(ALWAYS.steps);
  const rest = rules.flatMap((r) => r.steps).filter((s) => !always.has(s) && s !== "build" && landing(s));
  return ["build", ...ALWAYS.steps, ...new Set(rest)];
}

// **Seen to select before it is trusted**, on the three changes that motivated it.
function selfTest() {
  const names = (changes) => owed(changes).map((r) => r.name).join(", ");
  const example = names([{ path: "tests/programs/is-array-of-object/tsconfig.json", added: true }, { path: "tests/programs/is-array-of-object/src/main.ts", added: true }]);
  if (!example.includes("a new example") || example.includes("an example changed")) return `a new example: ${example}`;
  const blocked = names([{ path: "tooling/conformance/build-floor.sh", added: false }]);
  if (!blocked.includes("an instrument")) return `a change to build-floor.sh: ${blocked}`;
  const tool = names([{ path: "tooling/census/rows.ts", added: false }]);
  if (!tool.includes("an instrument")) return `a change to a TypeScript tool: ${tool}`;
  const blocker = owed([{ path: "tests/refusals/x/src/main.ts", added: true }]);
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
  if (!["test262-cases", "test262-builtins-cases", "test262-rest-cases", "test262-jvm", "test262-llvm", "typescript-cases"].every((st) => lowered.steps.includes(st))) return "a lowering change does not owe the recorded test262 sets on every backend";
  if (!lowered.steps.includes("benches")) return "a lowering change does not owe the benches corpus";
  // Its own steps first, then what the crates that link it add (the CLI, the
  // suite, the bench driver): a crate's own rule never stands in for theirs.
  const order = gateSteps(owed([{ path: "compiler/codegen/llvm/src/lib.rs", added: false }]));
  if (order.slice(0, 9).join(" ") !== "build clippy tests rustfmt old-paths llvm llvm-rc assembles benches" || !order.includes("corpus") || order.includes("bench-agree")) return `the LLVM backend's steps: ${order.join(" ")}`;
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
  const projects = interopOwed(rules);
  const narrowed = Array.isArray(projects) ? ` NTS_INTEROP_PROJECTS="${projects.join(" ")}"` : "";
  const docCrates = [...new Set(rules.flatMap(r => r.doctests ?? []))];
  const docEnv = docCrates.length ? ` NTS_DOCTEST_CRATES="${docCrates.join(" ")}"` : "";
  // A bare all.sh is every step there is, which only the runner and the gate
  // trees' inputs owe; the full gate is every core step, so it is a list, and
  // `land.ts` runs exactly that list (`WIDE` is the full run's).
  const every = rules.some((r) => r.full && r.wide);
  const gate = every
    ? "sh tooling/gate/all.sh   # the full gate"
    : `NTS_GATE_STEPS="${steps.join(" ")}"${narrowed}${docEnv} sh tooling/gate/all.sh${rules.some((r) => r.full) ? "   # every core step" : ""}`;
  const arm = (a) => `${a.if ? `if ${a.if}: ` : ""}${a.asks}\n        ${a.run}`;
  console.log(`  ${changes.length} path(s) changed in ${TREE}`);
  if (changes.some(c => isStrictPath(c.path))) console.log("  landing policy: strict gate-before-land (verdict machinery)");
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
    const env = { ...process.env, NTS_GATE_STEPS: steps.join(" ") };
    delete env.NTS_INTEROP_PROJECTS;
    delete env.NTS_DOCTEST_CRATES;
    if (Array.isArray(projects)) env.NTS_INTEROP_PROJECTS = projects.join(" ");
    if (docCrates.length) env.NTS_DOCTEST_CRATES = docCrates.join(" ");
    const run = spawnSync("sh", ["tooling/gate/all.sh"], { cwd: TREE, stdio: "inherit", env });
    const left = rules.flatMap((r) => r.arms).length;
    console.log(`\n  gate steps: ${run.status === 0 ? "green" : `FAILED (exit ${run.status ?? run.signal})`}; ${left} arm(s) above are still yours`);
    process.exit(run.status === 0 ? 0 : 1);
  }
}

// Run as a command; imported (owed.test.mjs), it only exports.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
