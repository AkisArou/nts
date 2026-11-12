import {fixtureEnvironment} from "../gate/test-environment.ts";
// Running a landing's steps: the build first, the rest through the gate's own
// runner, both admitted by the memory ledger, memory pressure retried, pending
// lines collected. Its tests are run-candidate, run-steps and run-holds:
//
//   node --test tooling/landing/run-*.test.ts
//
// The tree is a fixture whose tooling/gate holds the real run.mjs and step
// table beside a stand-in all.sh: each step does what a file in the fixture's
// controls says (pass, fail, pressure once, pending lines). The gate's
// environment drops a launcher's variables, so the controls are files. The
// fixture has its own HOME, so the runner's binary pins stay in it, and its
// own memory reading and ledger, so neither the host's memory nor the
// machine's queue decides a landing here. Each test's real gate run captures
// its own oracle dependencies, which is most of its time, so the tests are
// three files by subject that run beside each other.
import {type TestContext} from "node:test";
import {execFileSync} from "node:child_process";
import {chmodSync,copyFileSync,mkdirSync,readFileSync,symlinkSync,writeFileSync} from "node:fs";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {ENVIRONMENT_CONTEXT} from "../gate/canonical-environment.ts";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {moduleClosure} from "../gate/module-closure-fixture.ts";
import {PROFILE,removeRun,type RunOptions} from "./run.ts";
import {newTestScratch} from "../gate/test-scratch.ts";
import {ownMemory} from "../gate/test-memory.ts";


export const GATE = dirname(fileURLToPath(new URL("../gate/all.sh", import.meta.url)));

export function fixture(t: TestContext) {
  // A red run keeps read-only captured inputs in its temporary directory: removeRun restores them first.
  const own = newTestScratch("landing-run"); t.after(() => removeRun(own));
  const tree = join(own, "tree"), gate = join(tree, "tooling/gate"), controls = join(own, "controls"), home = join(own, "home");
  const target = join(home, ".cache/target"), run = join(home, ".cache/runs/one");
  for (const dir of [gate, controls, target]) mkdirSync(dir, { recursive: true });
  for (const name of moduleClosure(["tooling/gate/run.mjs"])) {
    const target = join(tree, name), original = join(GATE, "../..", name);
    mkdirSync(dirname(target), {recursive: true});
    if (name === "tooling/gate/run.mjs") writeFileSync(target, readFileSync(original));
    else copyFileSync(original, target);
  }
  oracleWorkspaceFixture(t,tree);
  writeFileSync(join(tree,".tool-versions"),`nodejs ${process.versions.node}\n`);
  symlinkSync(fileURLToPath(new URL("../gate/times.tsv", import.meta.url)), join(gate, "times.tsv"));
  const names = execFileSync("sh", [join(GATE, "all.sh"), "--list"], {env:fixtureEnvironment(t), encoding: "utf8" }).trim();
  writeFileSync(join(gate, "all.sh"), `#!/bin/sh
controls=${JSON.stringify(controls)}
if [ "$1" = --list ]; then
cat <<'NAMES'
${names}
NAMES
exit 0
fi
if [ "$1" = --call ]; then
  step=$2
  control=$(cat "$controls/$step" 2>/dev/null || echo pass)
  instrument() { printf '{"version":1,"verdict":"%s","kind":"%s","step":"%s","attempt":"%s","reason":"%s"}\\n' "$1" "$2" "$step" "$NTS_GATE_STEP_ATTEMPT" "$3" > "$NTS_GATE_STEP_RESULT"; exit 75; }
  if [ "$step" = program-oracles ]; then
    node --input-type=module -e 'import {createProgramOracleResults} from ${JSON.stringify(new URL("../differential/oracle-results.ts",import.meta.url).href)};import {programOracleDirectory} from ${JSON.stringify(new URL("../differential/oracle-result-scope.ts",import.meta.url).href)};import {oracleRecipeIdentity} from ${JSON.stringify(new URL("../differential/oracle-emit.ts",import.meta.url).href)};import {join} from "node:path";createProgramOracleResults(join(programOracleDirectory(),"results"),oracleRecipeIdentity()).publish();' || exit $?
  fi
  echo "$step $NTS_TEST_PROFILE $NTS_BIN $CARGO_INCREMENTAL" >> "$controls/calls"
  [ "$step" = doctests ] && echo "$NTS_DOCTEST_CRATES" > "$controls/doctest-crates"
  case $control in
    pass) echo "  $step: every case as recorded"; exit 0 ;;
    oracle-context) node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs";import {createHash} from "node:crypto";const capture=JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES),parent=readFileSync(${JSON.stringify(join(controls,"parent-record"))},"utf8");writeFileSync(${JSON.stringify(join(controls,"oracle-context.json"))},JSON.stringify({capture,imageSource:JSON.parse(readFileSync(capture.seal.record,"utf8")).source,parentSha256:createHash("sha256").update(readFileSync(parent)).digest("hex"),temporary:JSON.parse(process.env[${JSON.stringify(ENVIRONMENT_CONTEXT)}]).temporary}));'; exit $? ;;
    fail) echo "  $step: a recorded case went wrong"; exit 1 ;;
    pending) echo "  pending: tests/x/a.ts is not recorded in results/x.tsv yet"; echo "  improved, record pending: tests/x/b.ts refused -> pass"; exit 0 ;;
    pressure) [ -e "$controls/$step.pressured" ] && exit 0; : > "$controls/$step.pressured"; instrument INSTRUMENT memory-pressure "memory: 9.0 GB available" ;;
    always-pressure) instrument INSTRUMENT memory-pressure "memory: 9.0 GB available" ;;
    hung) instrument "NOT RUN" hung "no progress for 600 s" ;;
    stuck) echo "  $step: waits for ever"; exec tail -f /dev/null ;;
  esac
fi
exec node "$(dirname "$0")/run.mjs" "$@"
`);
  chmodSync(join(gate, "all.sh"), 0o755);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: tree, encoding: "utf8", env: { ...fixtureEnvironment(t), GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@a", GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@a" } }).trim();
  const commit = git("rev-parse", "HEAD");
  const memory = ownMemory(join(own, "memory"));
  const build = join(own, "build.sh");
  writeFileSync(build, `#!/bin/sh\n[ "$(cat ${JSON.stringify(join(controls, "build"))} 2>/dev/null)" = fail ] && { echo "error[E0308]: mismatched types"; exit 101; }\nmkdir -p "$CARGO_TARGET_DIR/${PROFILE}" && echo "nts $CARGO_INCREMENTAL" > "$CARGO_TARGET_DIR/${PROFILE}/nts" && chmod +x "$CARGO_TARGET_DIR/${PROFILE}/nts"\necho "   Compiling nts-core"\n`);
  chmodSync(build, 0o755);
  const control = (step: string, what: string) => writeFileSync(join(controls, step), what);
  const options = (steps: string[], extra: Partial<RunOptions> = {}): RunOptions => ({
    tree, target, run, commit, steps, build: [build], env: { ...fixtureEnvironment(t), HOME: home },
    owned: { NTS_GATE_SLOTS: "4", ...memory }, ...extra,
  });
  return { own, tree, target, run, controls, control, options, memory, calls: () => { try { return readFileSync(join(controls, "calls"), "utf8").trim().split("\n"); } catch { return []; } } };
}

// A job that holds the ledger's room until a request waits behind it.
export const HOLDER = `import { mkdirSync, readdirSync, watch } from "node:fs";
const waiting = process.argv[1] + "/waiting";
mkdirSync(waiting, { recursive: true });
const asked = () => readdirSync(waiting).some(name => name.endsWith(".json"));
await new Promise(resolve => { const watcher = watch(waiting, () => { if (asked()) { watcher.close(); resolve(); } }); if (asked()) { watcher.close(); resolve(); } });`;
