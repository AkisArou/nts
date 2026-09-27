// Which checks does this change owe? Takes the change, not the author's
// reading of it, and prints the checklist.
//
//   node tooling/gate/owed.mjs                  uncommitted and untracked changes
//   node tooling/gate/owed.mjs --since <rev>    everything since <rev>, plus uncommitted
//   node tooling/gate/owed.mjs --commit <rev>   one commit's changes
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
// It prints, it does not run: most of the value is the list, and the arms
// take minutes to an hour. `<before>` is a clean build of the base the change
// sits on and `<after>` a clean build with it -- never `target/release/nts`,
// which is whichever session linked last.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * What a change owes, as data. `when` sees one changed path and whether it is
 * new; `arms` are the commands, shown once however many paths matched.
 */
export const RULES = [
  {
    name: "a new example",
    when: (p, added) => added && /^examples\/[^/]+\/tsconfig\.json$/.test(p),
    why: "an example is an input to every backend step and must agree on each; one that passes before the change as well measured nothing",
    arms: [
      "node tooling/differential/agree.mjs <after> --only=<example>",
      "NTS_BACKEND=llvm node tooling/differential/agree.mjs <after> --only=<example>",
      "NTS_BACKEND=llvm NTS_RC=1 node tooling/differential/agree.mjs <after> --only=<example>",
      "NTS_BACKEND=jvm node tooling/differential/agree.mjs <after> --only=<example>",
      "NTS_RC=1 node tooling/differential/agree.mjs <after> --only=<example>",
      "node tooling/differential/agree.mjs <before> <after> --only=<example>   # must not read `unchanged` if it guards the change",
      "node tooling/conformance/integrity.mjs examples/<example>",
      "commit it before a pinned gate run: a worktree gate cannot see an uncommitted example",
    ],
  },
  {
    name: "an example changed",
    when: (p, added) => !added && /^examples\/[^/]+\//.test(p),
    why: "the same six backend arms read it",
    arms: [
      "node tooling/differential/agree.mjs <after> --only=<example>   # and NTS_BACKEND=llvm, jvm, NTS_RC=1",
    ],
  },
  {
    name: "lowering",
    when: (p) => /^compiler\/core\//.test(p),
    why: "a lowering change moves refusals, definitions and answers; each is a different instrument",
    arms: [
      "node tooling/differential/agree.mjs <before> <after>   # and NTS_BACKEND=llvm, NTS_BACKEND=jvm, NTS_RC=1",
      "node tooling/conformance/refusal-diff.mjs <before> <after>   # 0 moves is not no effect",
      "NTS_BIN=<after> node tooling/census/definitions.mjs   # a rise is read, not raised",
      "NTS_BIN=<after> node tooling/conformance/outcomes-check.mjs",
      "NTS_BIN=<after> node tooling/conformance/integrity.mjs; ... --runtime",
      "a full test262 census against a baseline if it should make programs compile (--recorded cannot see a gain)",
      "cargo test -p nts-core",
    ],
  },
  {
    name: "the C backend",
    when: (p) => /^compiler\/codegen\/c\//.test(p),
    why: "the differential on that backend, under both memory providers",
    arms: [
      "node tooling/differential/agree.mjs <before> <after>; NTS_RC=1 ...",
      "NTS_BIN=<after> node tooling/conformance/outcomes-check.mjs",
      "NTS_BIN=<after> node tooling/conformance/snapshot-cache.mjs   # emitted C byte-identical across the cache",
      "cargo test -p nts-codegen-c",
    ],
  },
  {
    name: "the LLVM backend",
    when: (p) => /^compiler\/codegen\/llvm\//.test(p),
    why: "the differential only reaches examples; the runtime's IR is only ever assembled by `assembles`",
    arms: [
      "NTS_BACKEND=llvm node tooling/differential/agree.mjs <before> <after>; NTS_RC=1 ...",
      "NTS_BIN=<after> node tooling/conformance/assembles.mjs",
      "cargo test -p nts-codegen-llvm",
    ],
  },
  {
    name: "the JVM backend",
    when: (p) => /^compiler\/codegen\/jvm\//.test(p),
    why: "the JVM verifier sees type confusions C and LLVM agree on by luck",
    arms: [
      "NTS_BACKEND=jvm node tooling/differential/agree.mjs <before> <after>",
      "cargo test -p nts-codegen-jvm",
    ],
  },
  {
    name: "the frontend or the snapshot schema",
    when: (p) => /^compiler\/(frontend-ts|semantic-schema)\//.test(p),
    why: "a schema field bumps SCHEMA_VERSION; a cache identity is a claim nothing else cross-checks",
    arms: [
      "bump SCHEMA_VERSION if a semantic-schema struct changed",
      "NTS_BIN=<after> node tooling/conformance/snapshot-cache.mjs",
      "node tooling/differential/agree.mjs <before> <after>",
    ],
  },
  {
    name: "a runtime helper",
    when: (p) => /^runtime\/c\/nts_runtime\.h$/.test(p),
    why: "a new nts_* helper owes four cross-check tables and two core tests; missing them has turned main red twice",
    arms: [
      "cargo test -p nts-core --test runtime_signatures",
      "cargo test -p nts-codegen-llvm --test signatures",
      "cargo test -p nts-codegen-c --lib   # ERASES_CLASS for an NtsHeader * parameter",
      "cargo test -p nts-codegen-jvm --test runtime_agrees_with_hir   # REFUSED_FLOOR",
      "cargo test -p nts-core --lib   # the table is sorted; an nts_array_* helper says whether it changes a length",
    ],
  },
  {
    name: "the C runtime",
    when: (p) => /^runtime\/c\//.test(p),
    why: "runtime/c is include_str!-ed into the compiler, and the gate formats it",
    arms: [
      "clang-format the runtime/c files you touched (the gate's `format` step)",
      "rebuild nts: runtime/c is compiled into the binary, so an old one tests the old runtime",
      "node tooling/differential/agree.mjs <before> <after>; NTS_RC=1 ...; NTS_BACKEND=llvm ...",
      "NTS_BIN=<after> node tooling/conformance/assembles.mjs",
    ],
  },
  {
    name: "a runtime module",
    when: (p) => /^runtime\/(node|web-platform)\//.test(p),
    why: "the runtime is a corpus: its definitions, integrity, IR and addons are each measured separately",
    arms: [
      "NTS_BIN=<after> node tooling/census/definitions.mjs",
      "NTS_BIN=<after> node tooling/conformance/integrity.mjs --runtime",
      "NTS_BIN=<after> node tooling/conformance/assembles.mjs",
      "the `addons` step (build-floor.sh), which also asks whether each module publishes anything",
      "node tooling/conformance/compiled-axis-floor.mjs   # node's own tests per module; lane-local, ~16 min",
    ],
  },
  {
    name: "an instrument",
    when: (p) => /^tooling\/(conformance|census|differential|gate)\/.*\.(mjs|sh)$/.test(p),
    why: "an instrument first finds itself; a loop that has never had input is untested code",
    arms: [
      "its --self-test, if it has one",
      "a sabotage arm: break the thing it guards and watch it fail, naming the thing",
      "feed any list it loops over one entry, in a scratch copy, before relying on it",
      "if it parses a node helper's output: process.stdout.write(String(x)), never console.log(x)",
    ],
  },
  {
    name: "the gate script",
    when: (p) => p === "tooling/gate/all.sh",
    why: "shared by every lane, and bash reads a running script incrementally",
    arms: [
      "sh -n tooling/gate/all.sh",
      "NTS_GATE_STEPS=\"<the steps you touched>\" sh tooling/gate/all.sh, from a worktree",
      "announce it to the lanes; never edit it while a run from this tree is executing",
    ],
  },
  {
    name: "an outcomes fixture",
    when: (p) => /^tooling\/conformance\/outcomes\//.test(p),
    why: "a record is a claim about main: recorded from a clean build, with a control that differs in one thing",
    arms: [
      "NTS_BIN=<a clean main build> node tooling/conformance/outcomes-check.mjs --record <name>",
      "the control arm, measured: the same program differing in one thing agrees",
      "node tooling/conformance/integrity.mjs tooling/conformance/outcomes/<name>   # name a deliberate cut in integrity.known",
    ],
  },
];

/** Every change, whatever it touched. */
const ALWAYS = {
  name: "every change",
  why: "the gate runs these first, and a one-line edit is not exempt",
  arms: ["cargo clippy --workspace --all-targets   # the gate fails on any warning", "cargo test --workspace"],
};

/** `{ path, added }` for the change asked about. */
function changedPaths(argv) {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
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

const changes = changedPaths(argv);
if (changes.length === 0) {
  console.log("  no change: nothing owed");
  process.exit(0);
}
const rules = owed(changes);
console.log(`  ${changes.length} path(s) changed; owed:`);
for (const r of rules) {
  console.log(`\n  ${r.name}${r.paths.length ? ` (${r.paths.slice(0, 3).join(", ")}${r.paths.length > 3 ? `, +${r.paths.length - 3}` : ""})` : ""}`);
  console.log(`    why: ${r.why}`);
  for (const a of r.arms) console.log(`    [ ] ${a}`);
}
