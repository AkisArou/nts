// land.ts against a scratch repository and a stand-in gate: the train.
//
//   node --test tooling/lanes/land.test.ts
//
// Each test makes a repository whose `tooling/gate/pinned.sh` is a stand-in:
// it checks the commit out in the gate tree and writes a summary that is red
// when the commit has a file named RED, and it logs every commit it gates. The
// lock is held while the landings queue, so whoever takes it next finds them
// all waiting, as a lane does behind a half-hour gate.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpuList, gateCpus, inheritedCpus } from "../gate/affinity.ts";

const LAND = new URL("./land.ts", import.meta.url).pathname;

const STAND_IN_GATE = `set -eu
sha=$1
if [ -e "$NTS_GATE_TREE/.git" ]; then
  git -C "$NTS_GATE_TREE" checkout -q --detach --force "$sha"
else
  git worktree add -q --detach "$NTS_GATE_TREE" "$sha"
fi
[ -n "\${NTS_GATE_SETUP_ONLY:-}" ] && exit 0
if [ -n "\${LAND_TEST_AFFINITY:-}" ]; then
  awk '/^Cpus_allowed_list:/ {print $2}' /proc/self/status > "$LAND_TEST_AFFINITY"
  sh -c 'awk "/^Cpus_allowed_list:/ {print \\$2}" /proc/self/status' >> "$LAND_TEST_AFFINITY"
fi
if [ -n "\${LAND_TEST_CHECKERS:-}" ]; then
  test "$NTS_CHECKERS" = "1"
fi
printf '%s' "\${CARGO_PROFILE_DEV_DEBUG-unset}" > "$NTS_GATE_RUN_DIR/test-debug-mode"
echo "$sha \${NTS_INTEROP_PROJECTS:-}" >> "$LAND_TEST_GATES"
verdict=green step=PASS
if [ -e "$NTS_GATE_TREE/RED" ]; then verdict=red step=FAIL; fi
# A platform whose programs never ran, as interop's log says it.
echo "  windows-hello    skipped: SKIP windows-x86_64 (hello): not run" > "$NTS_GATE_RUN_DIR/interop.log"
echo "  apple-hello      skipped: SKIP macos (hello): not run" >> "$NTS_GATE_RUN_DIR/interop.log"
printf '{"verdict":"%s","started":"t","wall_s":1,"steps":[{"name":"fake","verdict":"%s","log":"%s"}],"identities":{"commit":"%s"}}' \\
  "$verdict" "$step" "$NTS_GATE_RUN_DIR/interop.log" "$sha" > "$NTS_GATE_RUN_DIR/summary.json"
`;

type Scratch = { root: string; home: string; gates: string; env: NodeJS.ProcessEnv };

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function scratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "land-test-"));
  made.push(dir);
  const root = join(dir, "repo");
  const home = join(dir, "home");
  mkdirSync(join(home, ".cache/nts-parallel-20261004/mainctl"), { recursive: true });
  mkdirSync(join(root, "tooling/gate"), { recursive: true });
  writeFileSync(join(root, "tooling/gate/pinned.sh"), STAND_IN_GATE);
  writeFileSync(join(root, "tooling/gate/run.mjs"), 'process.stdout.write(JSON.stringify({fake: []}));\n');
  // Narrows interop to what a commit's INTEROP file names, as owed.mjs does.
  writeFileSync(
    join(root, "tooling/gate/owed.mjs"),
    `import { existsSync, readFileSync } from "node:fs";\nconst p = existsSync("INTEROP") ? \` NTS_INTEROP_PROJECTS="\${readFileSync("INTEROP", "utf8").trim()}"\` : "";\nconsole.log(\`NTS_GATE_STEPS="fake"\${p} sh tooling/gate/all.sh\`);\n`,
  );
  writeFileSync(join(root, "shared.txt"), "one\n");
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_") && !k.startsWith("NTS_")) env[k] = v;
  Object.assign(env, {
    NTS_LAND_HOME: home,
    LAND_TEST_GATES: join(dir, "gates.log"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  });
  const s = { root, home, gates: join(dir, "gates.log"), env };
  run(s, root, ["init", "-q", "-b", "main"]);
  run(s, root, ["add", "-A"]);
  run(s, root, ["commit", "-q", "-m", "base"]);
  return s;
}

function run(s: Scratch, cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, env: s.env, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A lane's tree on its own branch from main, with one commit writing `files`. */
function lane(s: Scratch, name: string, files: Record<string, string>): string {
  // These model persistent agent homes: successful landings must leave their
  // checked-out branches attached for the next commit.
  const tree = join(s.home, "Projects/nts-lanes", name);
  mkdirSync(dirname(tree), { recursive: true });
  run(s, s.root, ["worktree", "add", "-q", "-b", name, tree, "main"]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  }
  run(s, tree, ["add", "-A"]);
  run(s, tree, ["commit", "-q", "-m", name]);
  return tree;
}

type Landed = { status: number | null; out: string };

function land(s: Scratch, tree: string, cpus?: string): { child: ChildProcess; done: Promise<Landed> } {
  const child = cpus
    ? spawn("taskset", ["-c", cpus, process.execPath, LAND, "HEAD"], { cwd: tree, env: s.env })
    : spawn(process.execPath, [LAND, "HEAD"], { cwd: tree, env: s.env });
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (out += d));
  const done = new Promise<Landed>((resolve) => child.on("exit", (status) => resolve({ status, out })));
  return { child, done };
}

// A minute, not seconds: the gate runs this beside its heavy steps, where a
// landing can take more than ten seconds to start and join the queue. Only a
// real hang should fail here.
async function until(what: string, ok: () => boolean): Promise<void> {
  for (let i = 0; i < 1200; i++) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("a landing keeps its warm test cache and uses line-table debug information", async () => {
  const s = scratch();
  const tree = lane(s, "warm-tests", { "change": "one\n" });
  const cache = join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-target/debug/build/generated/out");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "private.rs"), "generated cache content\n");
  const result = await land(s, tree).done;
  assert.equal(result.status, 0, result.out);
  assert.equal(readFileSync(join(cache, "private.rs"), "utf8"), "generated cache content\n");
  const runs = join(s.home, ".cache/nts-land/runs");
  const run = readdirSync(runs)[0];
  assert.equal(readFileSync(join(runs, run, "test-debug-mode"), "utf8"), "line-tables-only");
});

test("an oversized Cargo cache is cleaned whole and the train proceeds", async () => {
  const s = scratch();
  writeFileSync(join(s.root, "Cargo.toml"), "[workspace]\n");
  run(s, s.root, ["add", "Cargo.toml"]);
  run(s, s.root, ["commit", "-q", "-m", "Cargo workspace"]);
  const tree = lane(s, "cache-limit", { "change": "one\n" });
  const cache = join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-target/debug/build/generated/out");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "private.rs"), "obsolete generated output\n");
  const target = join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-target");
  mkdirSync(join(target, "debug/.fingerprint/old"), { recursive: true });
  writeFileSync(join(target, "debug/.fingerprint/old/state"), "obsolete Cargo state\n");
  mkdirSync(join(target, "release"));
  writeFileSync(join(target, "release/nts"), "keep release\n");
  assert.equal(existsSync(join(target, "CACHEDIR.TAG")), false);
  const bin = join(s.home, "bin");
  mkdirSync(bin);
  // Exercise the real landing guard without allocating seventy GiB.
  writeFileSync(join(bin, "du"), "#!/bin/sh\nprintf '73400320\\tcache\\n'\n");
  chmodSync(join(bin, "du"), 0o755);
  s.env.PATH = `${bin}:${s.env.PATH}`;
  const result = await land(s, tree).done;
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /Cargo dev-profile clean removed 70.0 GiB/);
  assert.equal(existsSync(join(target, "debug")), false);
  assert.equal(readFileSync(join(target, "release/nts"), "utf8"), "keep release\n");
  assert.match(readFileSync(join(target, "CACHEDIR.TAG"), "utf8"), /^Signature: 8a477f597d28d172789f06886806bc55\n/);
  assert.equal(gates(s), 1, "the train runs after cleaning the obsolete profile");
});

test("low disk still refuses a train and keeps a warm profile", () => {
  const s = scratch();
  writeFileSync(join(s.root, "Cargo.toml"), "[workspace]\n");
  run(s, s.root, ["add", "Cargo.toml"]);
  run(s, s.root, ["commit", "-q", "-m", "Cargo workspace"]);
  const tree = lane(s, "disk-floor", { "change": "one\n" });
  const cache = join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-target/debug/keep");
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, "keep the warm profile\n");
  // Replace the free-space observation without filling the shared disk. The
  // preload must survive the lander's re-entry under its own flock.
  const preload = join(s.home, "low-disk.ts");
  writeFileSync(preload, `import fs from "node:fs";\nimport { syncBuiltinESMExports } from "node:module";\nconst actual = fs.statfsSync;\nfs.statfsSync = (...args) => ({ ...actual(...args), bavail: 1 });\nsyncBuiltinESMExports();\n`);
  const result = spawnSync(process.execPath, [LAND, "HEAD"], { cwd: tree, env: { ...s.env, NODE_OPTIONS: `--import=${preload}` }, encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /working space above the 40 GiB disk floor/);
  assert.equal(readFileSync(cache, "utf8"), "keep the warm profile\n");
  assert.equal(gates(s), 0);
});

test("missing gate environment refuses before queueing or waiting for a held lock", async () => {
  const s = scratch();
  const tree = lane(s, "android-env", {
    "tooling/gate/owed.mjs": 'console.log(\'NTS_GATE_STEPS="dex"\');\n',
    "tooling/gate/run.mjs": 'process.stdout.write(JSON.stringify({dex: ["android"]}));\n',
  });
  s.env.ANDROID_HOME = "";
  const lock = join(s.home, ".cache/nts-land.lock");
  writeFileSync(lock, "");
  const holder = spawn("flock", [lock, "sleep", "60"], { detached: true });
  try {
    await until("the lock to be held", () => readFileSync("/proc/locks", "utf8").includes(`${holder.pid} `));
    const result = spawnSync(process.execPath, [LAND, "HEAD"], { cwd: tree, env: s.env, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /ANDROID_HOME is missing; required by step dex/);
    assert.match(result.stderr, /node tooling\/lanes\/land-unit.ts/);
    assert.equal(existsSync(join(s.home, ".cache/nts-land/queue")), false);
    assert.equal(gates(s), 0);
  } finally {
    process.kill(-holder.pid!, "SIGTERM");
  }
});

test("the locked train rechecks capabilities before starting its gate", async () => {
  const s = scratch();
  const tree = lane(s, "train-env", {
    "tooling/gate/owed.mjs": 'console.log(\'NTS_GATE_STEPS="dex"\');\n',
    "tooling/gate/run.mjs": 'process.stdout.write(JSON.stringify({dex: ["android"]}));\n',
  });
  s.env.ANDROID_HOME = "";
  // Enter at the train half, bypassing the pre-queue check as its flock child does.
  s.env.NTS_LAND_LOCKED = "1";
  const result = await land(s, tree).done;
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /ANDROID_HOME is missing; required by step dex/);
  assert.equal(gates(s), 0);
});

/** Land every tree at once: the lock is held until all of them are queued. */
async function landTogether(s: Scratch, trees: string[]): Promise<Landed[]> {
  const lock = join(s.home, ".cache/nts-land.lock");
  writeFileSync(lock, "");
  // Its own process group: `sleep` inherits the lock from `flock`, so both go.
  const holder = spawn("flock", [lock, "sleep", "60"], { detached: true });
  await until("the lock to be held", () => readFileSync("/proc/locks", "utf8").includes(`${holder.pid} `));
  // One at a time, so the queue's order is the order given.
  const queue = join(s.home, ".cache/nts-land/queue");
  const landings = [];
  for (const tree of trees) {
    landings.push(land(s, tree));
    await until(`${tree} to queue`, () => existsSync(queue) && readdirSync(queue).length === landings.length);
  }
  process.kill(-holder.pid!, "SIGTERM");
  return Promise.all(landings.map((l) => l.done));
}

const gates = (s: Scratch) => (existsSync(s.gates) ? readFileSync(s.gates, "utf8").trim().split("\n").length : 0);
const onMain = (s: Scratch, path: string) => spawnSync("git", ["cat-file", "-e", `main:${path}`], { cwd: s.root, env: s.env }).status === 0;

test("native inputs link the upstream TypeScript corpus without an external compiler", () => {
  const s = scratch();
  const corpus = join(s.root, "third_party/typescript");
  mkdirSync(corpus, { recursive: true });
  writeFileSync(join(corpus, "marker"), "upstream corpus\n");
  const a = lane(s, "native-inputs", { "pnpm-lock.yaml": "importers: {}\n" });
  for (const mode of ["lane", "gate"]) {
    const prepared = spawnSync("sh", [new URL("./inputs.sh", import.meta.url).pathname, mode, s.root, a], { env: s.env, encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(realpathSync(join(a, "third_party/typescript")), corpus);
  }
});

test("landing gives batch processes one checker instead of a caller override", async () => {
  const s = scratch();
  s.env.LAND_TEST_CHECKERS = "1";
  s.env.NTS_CHECKERS = "8";
  const a = lane(s, "frontend", { "a.txt": "a" });
  const result = await land(s, a).done;
  assert.equal(result.status, 0, result.out);
});

test("the gate and its grandchild exclude the measurement core, preserving an E-core caller", { skip: process.platform !== "linux" }, async () => {
  const inherited = inheritedCpus();
  const eCores = cpuList(inherited).filter((cpu) => cpu >= 16);
  assert.ok(eCores.length > 0, "this host has E-cores for the inherited-mask control");
  for (const confined of [undefined, String(eCores[0])]) {
    const s = scratch();
    s.env.LAND_TEST_AFFINITY = join(s.home, "affinity.json");
    const tree = lane(s, "affinity", { "a.txt": "a\n" });
    const result = await land(s, tree, confined).done;
    assert.equal(result.status, 0, result.out);
    const expected = gateCpus(confined ?? inherited);
    assert.deepEqual(readFileSync(s.env.LAND_TEST_AFFINITY, "utf8").trim().split("\n"), [expected, expected]);
    assert.ok(result.out.includes(`gate affinity: CPUs ${expected}; measurement CPUs 4-5 excluded`), result.out);
    const run = JSON.parse(readFileSync(join(s.home, ".cache/nts-land/status.json"), "utf8")).run;
    assert.ok(readFileSync(join(run, "gate.log"), "utf8").includes(`gate affinity: CPUs ${expected};`));
  }
});

test("a marker a dead landing left behind does not stop the next", async () => {
  const s = scratch();
  const marker = join(s.home, ".cache/nts-parallel-20261004/mainctl/GATE-RUNNING");
  writeFileSync(marker, "land deadbeef0000 2026-10-21T19:37:31.275Z\n");
  const a = lane(s, "a", { "a.txt": "a\n" });
  const r = await land(s, a).done;
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /removing a dead landing's marker/);
  assert.ok(onMain(s, "a.txt"));
  assert.ok(!existsSync(marker), "the landing removes its own marker when it is done");
});

test("one gate lands every landing queued behind the lock", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const b = lane(s, "b", { "b.txt": "b\n" });
  const c = lane(s, "c", { "c.txt": "c\n" });
  const [ra, rb, rc] = await landTogether(s, [a, b, c]);
  for (const r of [ra, rb, rc]) {
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /LANDED .* in a train of 3/);
  }
  assert.equal(gates(s), 1);
  assert.ok(onMain(s, "a.txt") && onMain(s, "b.txt") && onMain(s, "c.txt"));
  assert.match(readFileSync(join(s.home, ".cache/nts-land/trains.tsv"), "utf8"), /\t3\tlanded\t/);
});

test("every member of a train carries the land note, not only its tip", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const b = lane(s, "b", { "b.txt": "b\n" });
  const [ra, rb] = await landTogether(s, [a, b]);
  const landed = (r: Landed) => /as ([0-9a-f]{12}): main is ([0-9a-f]{12})/.exec(r.out);
  const [first, second] = [landed(ra), landed(rb)];
  assert.ok(first && second, `${ra.out}\n${rb.out}`);
  const note = (sha: string) => run(s, s.root, ["notes", "--ref=land", "show", sha]);
  assert.match(note(second![1]), /train: /);
  assert.match(note(first![1]), new RegExp(`gated as part of: ${first![2]}`));
});

test("a red train is halved until the red landing is alone, and only it is refused", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const b = lane(s, "b", { "b.txt": "b\n" });
  const red = lane(s, "red", { RED: "\n" });
  const c = lane(s, "c", { "c.txt": "c\n" });
  const [ra, rb, rr, rc] = await landTogether(s, [a, b, red, c]);
  assert.equal(ra.status, 0, ra.out);
  assert.equal(rb.status, 0, rb.out);
  assert.equal(rc.status, 0, rc.out);
  assert.equal(rr.status, 1, rr.out);
  assert.match(rr.out, /gate not green: fake=FAIL/);
  assert.ok(onMain(s, "a.txt") && onMain(s, "b.txt") && onMain(s, "c.txt"));
  assert.ok(!onMain(s, "RED"));
  // [a b red c] red, [a b] green, [red c] red, [red] red, [c] green.
  assert.equal(gates(s), 8, "the three red attempts also check their failed step on main");
});

function memoryGate(s: Scratch, mainRed = false): void {
  writeFileSync(join(s.root, "tooling/gate/run.mjs"), 'process.stdout.write(JSON.stringify({fake: [], memory: []}));\n');
  writeFileSync(join(s.root, "tooling/gate/owed.mjs"), `
import { execFileSync } from "node:child_process";
const changed = execFileSync("git", ["diff", "--name-only", process.argv.at(-1)], {encoding: "utf8"}).split("\\n");
const steps = changed.includes("SELECT_MEMORY") ? "fake memory" : "fake";
console.log('NTS_GATE_STEPS="' + steps + '" sh tooling/gate/all.sh');
`);
  writeFileSync(join(s.root, "tooling/gate/pinned.sh"), STAND_IN_GATE.slice(0, STAND_IN_GATE.indexOf("verdict=green step=PASS")) + `
node - "$sha" <<'JS'
const {appendFileSync, existsSync, writeFileSync} = require("node:fs");
const {join} = require("node:path");
const requested = process.env.NTS_GATE_STEPS.split(/\\s+/);
const culprit = existsSync(join(process.env.NTS_GATE_TREE, "BAD_MEMORY"));
const steps = requested.map(name => ({name, verdict: name === "memory" && culprit ? "FAIL" : "PASS"}));
appendFileSync(process.env.LAND_TEST_GATES + ".steps", JSON.stringify({requested, culprit}) + "\\n");
writeFileSync(join(process.env.NTS_GATE_RUN_DIR, "summary.json"), JSON.stringify({
  verdict: steps.some(s => s.verdict === "FAIL") ? "red" : "green",
  steps, requested, started: "t", wall_s: 1, identities: {commit: process.argv[2]},
}));
JS
`);
  if (mainRed) writeFileSync(join(s.root, "BAD_MEMORY"), "already red on main\n");
  run(s, s.root, ["add", "tooling/gate", ...(mainRed ? ["BAD_MEMORY"] : [])]);
  run(s, s.root, ["commit", "-q", "-m", "a memory check selected only by another landing"]);
}

for (const culpritFirst of [true, false]) test(`halving keeps a red step the culprit does not owe (${culpritFirst ? "first" : "second"} half)`, async () => {
  const s = scratch();
  memoryGate(s);
  const culprit = lane(s, "culprit", { BAD_MEMORY: "the allocation regression\n" });
  const selector = lane(s, "selector", { SELECT_MEMORY: "select the memory check\n" });
  const asked = culpritFirst ? [culprit, selector] : [selector, culprit];
  const results = await landTogether(s, asked);
  const bad = results[culpritFirst ? 0 : 1];
  const good = results[culpritFirst ? 1 : 0];
  assert.equal(bad.status, 1, bad.out);
  assert.match(bad.out, /memory=FAIL/);
  assert.equal(good.status, 0, good.out);
  assert.equal(onMain(s, "BAD_MEMORY"), false);
  assert.equal(onMain(s, "SELECT_MEMORY"), true);
  const runs = readFileSync(s.gates + ".steps", "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(runs.length, 5, "the train and culprit failures each check main");
  assert.equal(runs.filter(r => r.culprit).length, 2);
  for (const r of runs) assert.ok(r.requested.includes("memory"), "neither half drops the train's red check");
});

for (const selectorFirst of [true, false]) test(`a red main refuses only the landing that owes its red step (${selectorFirst ? "first" : "second"} in train)`, async () => {
  const s = scratch();
  memoryGate(s, true);
  const unrelated = lane(s, "unrelated", { "unrelated.txt": "safe tooling change\n" });
  const selector = lane(s, "selector", { SELECT_MEMORY: "owes memory\n" });
  const results = await landTogether(s, selectorFirst ? [selector, unrelated] : [unrelated, selector]);
  const red = results[selectorFirst ? 0 : 1];
  const green = results[selectorFirst ? 1 : 0];
  assert.equal(red.status, 1, red.out);
  assert.match(red.out, /red on main.*memory/);
  assert.equal(green.status, 0, green.out);
  assert.equal(onMain(s, "SELECT_MEMORY"), false);
  assert.equal(onMain(s, "unrelated.txt"), true);
  const runs = readFileSync(s.gates + ".steps", "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(runs.length, 3, "failed train, base check, then only the unrelated landing");
  assert.deepEqual(runs.map(r => r.requested), [["fake", "memory"], ["memory"], ["fake"]]);
});

test("a landing that conflicts with one ahead of it is refused, and the train goes on", async () => {
  const s = scratch();
  const a = lane(s, "a", { "shared.txt": "from a\n" });
  const b = lane(s, "b", { "shared.txt": "from b\n" });
  const c = lane(s, "c", { "c.txt": "c\n" });
  const [ra, rb, rc] = await landTogether(s, [a, b, c]);
  assert.equal(ra.status, 0, ra.out);
  assert.equal(rc.status, 0, rc.out);
  assert.equal(rb.status, 1, rb.out);
  assert.match(rb.out, /does not replay onto main \(\w+\) or the 1 landing\(s\) ahead of it/);
  assert.equal(readFileSync(join(a, "shared.txt"), "utf8"), "from a\n");
  assert.equal(run(s, s.root, ["show", "main:shared.txt"]), "from a");
  assert.equal(gates(s), 1);
});

test("a landing alone still lands, and its changes already on main land as nothing", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const [first] = await landTogether(s, [a]);
  assert.equal(first.status, 0, first.out);
  assert.doesNotMatch(first.out, /train of/);
  // The same change again, made on another branch from the old main.
  run(s, s.root, ["branch", "again", "main~1"]);
  const again = join(s.root, "..", "again");
  run(s, s.root, ["worktree", "add", "-q", again, "again"]);
  writeFileSync(join(again, "a.txt"), "a\n");
  run(s, again, ["add", "-A"]);
  run(s, again, ["commit", "-q", "-m", "a again"]);
  const [second] = await landTogether(s, [again]);
  assert.equal(second.status, 0, second.out);
  assert.match(second.out, /changes are on main already/);
  assert.equal(gates(s), 1);
});

test("a landing that repeats one ahead of it in a red train is not told it landed", async () => {
  const s = scratch();
  const red = lane(s, "red", { RED: "\n", "a.txt": "a\n" });
  const again = lane(s, "again", { RED: "\n", "a.txt": "a\n" });
  const [rr, ra] = await landTogether(s, [red, again]);
  assert.equal(rr.status, 1, rr.out);
  assert.equal(ra.status, 1, ra.out);
  assert.ok(!onMain(s, "a.txt"));
});

test("the interop projects owed.mjs names reach the gate", async () => {
  const s = scratch();
  const a = lane(s, "a", { INTEROP: "java-from-ts ts-from-java\n" });
  const [ra] = await landTogether(s, [a]);
  assert.equal(ra.status, 0, ra.out);
  assert.match(ra.out, /owes: fake \(interop: java-from-ts ts-from-java\)/);
  assert.match(readFileSync(s.gates, "utf8"), / java-from-ts ts-from-java$/m);
});

test("a landing lands the commit it was queued with, though its tree moves on while it waits", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const lock = join(s.home, ".cache/nts-land.lock");
  writeFileSync(lock, "");
  const holder = spawn("flock", [lock, "sleep", "60"], { detached: true });
  await until("the lock to be held", () => readFileSync("/proc/locks", "utf8").includes(`${holder.pid} `));
  const landing = land(s, a);
  const queue = join(s.home, ".cache/nts-land/queue");
  await until("it to queue", () => existsSync(queue) && readdirSync(queue).length === 1);
  writeFileSync(join(a, "later.txt"), "later\n");
  run(s, a, ["add", "-A"]);
  run(s, a, ["commit", "-q", "-m", "later"]);
  process.kill(-holder.pid!, "SIGTERM");
  const r = await landing.done;
  assert.equal(r.status, 0, r.out);
  assert.ok(onMain(s, "a.txt"));
  assert.ok(!onMain(s, "later.txt"));
});

test("commits that landed as replayed copies are not replayed again", async () => {
  // The fixture-first workflow: a subject lands on its own, replayed because
  // main had moved, so main has a copy with another id; then main changes the
  // subject's file; then the fix lands from the branch that still holds the
  // original subject. Replaying that original again conflicts with main's
  // newer file (CompilerHelper's bigint fix, 2026-10-14).
  const s = scratch();
  const branch = lane(s, "fix", { "subject.txt": "one\n" });
  const subject = run(s, branch, ["rev-parse", "HEAD"]);
  const other = lane(s, "other", { "other.txt": "o\n" });
  const [ro] = await landTogether(s, [other]);
  assert.equal(ro.status, 0, ro.out);
  const [rs] = await landTogether(s, [branch]);
  assert.equal(rs.status, 0, rs.out);
  assert.notEqual(run(s, s.root, ["rev-parse", "main"]), subject, "the subject should have landed as a replayed copy");
  // Main changes the subject's file after it landed.
  run(s, s.root, ["checkout", "-q", "main"]);
  writeFileSync(join(s.root, "subject.txt"), "one, revised\n");
  run(s, s.root, ["commit", "-q", "-am", "revise the subject on main"]);
  // The fix, on top of the original subject.
  writeFileSync(join(branch, "fix.txt"), "fix\n");
  run(s, branch, ["add", "-A"]);
  run(s, branch, ["commit", "-q", "-m", "the fix"]);
  const [rf] = await landTogether(s, [branch]);
  assert.equal(rf.status, 0, rf.out);
  assert.ok(onMain(s, "fix.txt"));
  assert.equal(run(s, s.root, ["show", "main:subject.txt"]), "one, revised");
});

test("the dated platform policy accepts Windows SKIPs without a per-landing flag, and records it", async () => {
  // The Windows lane's paths, with no Windows reachable (the stand-in's log).
  const s = scratch();
  const test = lane(s, "test", { "compiler/codegen/c/tests/com.rs": "// a host test\n", "docs/windows-lane-goal.md": "notes\n" });
  const [rt] = await landTogether(s, [test]);
  assert.equal(rt.status, 0, rt.out);
  const runtime = lane(s, "runtime", { "runtime/winrt/x.c": "/* runs on Windows */\n" });
  const [rr] = await landTogether(s, [runtime]);
  assert.equal(rr.status, 0, rr.out);
  assert.match(run(s, s.root, ["notes", "--ref=land", "show", "main"]), /unrun accepted by user policy 2026-10-23: windows/);
  const apple = lane(s, "apple-runtime", { "runtime/objc/x.c": "/* runs on Apple */\n" });
  const [ra] = await landTogether(s, [apple]);
  assert.equal(ra.status, 0, ra.out);
  assert.match(run(s, s.root, ["notes", "--ref=land", "show", "main"]), /unrun accepted by user policy 2026-10-23: apple/);
});

test("the originating process retires only its own clean scratch submission after landing", async () => {
  const s = scratch();
  const home = lane(s, "compiler/scratch", { "landed.txt": "landed\n" });
  run(s, s.root, ["tag", "compiler/scratch", "main"]); // An ambiguous short name is not a branch identity.
  const disposable = join(s.home, ".cache/nts-scratch/compiler/submission"); mkdirSync(dirname(disposable), { recursive: true }); run(s, s.root, ["worktree", "move", home, disposable]);
  const r = await land(s, disposable).done;
  assert.equal(r.status, 0, r.out); assert.equal(existsSync(disposable), false);
  assert.equal(run(s, s.root, ["for-each-ref", "refs/heads/compiler/scratch"]), "");
  assert.ok(run(s, s.root, ["for-each-ref", "refs/tags/compiler/scratch"]));
  assert.ok(existsSync(join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-tree")), "the gate cache remains");
  assert.match(readFileSync(join(s.home, ".cache/nts-land/upkeep.jsonl"), "utf8"), /"operation":"delete-landed-topic"/);
});

test("a later landing revisits a recorded topic after its lane home switches away, leaving unsent branches alone", async () => {
  const s = scratch();
  const tree = lane(s, "compiler/first", { "first.txt": "first\n" });
  const first = await land(s, tree).done; assert.equal(first.status, 0, first.out);
  assert.equal(run(s, tree, ["symbolic-ref", "--short", "HEAD"]), "compiler/first");
  run(s, tree, ["switch", "-qc", "compiler/next", "main"]);
  writeFileSync(join(tree, "next.txt"), "next\n"); run(s, tree, ["add", "next.txt"]); run(s, tree, ["commit", "-qm", "next"]);
  run(s, s.root, ["branch", "compiler/never-submitted", "main"]);
  const second = await land(s, tree).done; assert.equal(second.status, 0, second.out);
  assert.equal(run(s, s.root, ["for-each-ref", "refs/heads/compiler/first"]), "");
  assert.ok(run(s, s.root, ["for-each-ref", "refs/heads/compiler/never-submitted"]));
  assert.equal(run(s, tree, ["symbolic-ref", "--short", "HEAD"]), "compiler/next");
});

test("an upkeep logging failure cannot turn a successful landing red", async () => {
  const s = scratch();
  const tree = lane(s, "logging", { "landed.txt": "landed\n" });
  mkdirSync(join(s.home, ".cache/nts-land/upkeep.jsonl"), { recursive: true });
  const r = await land(s, tree).done;
  assert.equal(r.status, 0, r.out); assert.ok(onMain(s, "landed.txt"));
  assert.match(r.out, /upkeep incomplete; landing remains successful/);
  assert.equal(run(s, tree, ["symbolic-ref", "--short", "HEAD"]), "logging");
});
