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
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpuList, gateCpus, inheritedCpus } from "../gate/affinity.ts";
import { frontendPath, frontendPin } from "./tsgo.ts";

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
if [ -n "\${LAND_TEST_FRONTEND:-}" ]; then
  test "$NTS_TSGO" = "$NTS_GATE_TREE/target/tsgo"
fi
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

test("inputs link each commit's frontend key and refuse its missing build by name", () => {
  const s = scratch();
  const upstream = join(s.root, "third_party/typescript-go");
  mkdirSync(upstream, { recursive: true });
  run(s, upstream, ["init", "-q"]);
  writeFileSync(join(upstream, "source.txt"), "upstream\n");
  run(s, upstream, ["add", "source.txt"]);
  run(s, upstream, ["commit", "-q", "-m", "upstream"]);
  const old = run(s, upstream, ["rev-parse", "HEAD"]);
  run(s, s.root, ["update-index", "--add", "--cacheinfo", `160000,${old},third_party/typescript-go`]);
  writeFileSync(join(s.root, "pnpm-lock.yaml"), "importers: {}\n");
  run(s, s.root, ["add", "pnpm-lock.yaml"]);
  run(s, s.root, ["commit", "-q", "-m", "pin frontend"]);
  const a = lane(s, "old-frontend", { "a.txt": "a" });
  writeFileSync(join(upstream, "source.txt"), "new upstream\n");
  run(s, upstream, ["commit", "-q", "-am", "new frontend"]);
  const next = run(s, upstream, ["rev-parse", "HEAD"]);
  const b = lane(s, "new-frontend", { "b.txt": "b" });
  run(s, b, ["update-index", "--cacheinfo", `160000,${next},third_party/typescript-go`]);
  run(s, b, ["commit", "-q", "-m", "bump frontend"]);
  const publish = (tree: string): string => {
    const pin = frontendPin(tree);
    const binary = frontendPath(s.root, pin);
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, `#!/bin/sh\necho ${pin.gitlink}\n`);
    chmodSync(binary, 0o755);
    writeFileSync(join(dirname(binary), "build.json"), JSON.stringify({ key: pin.key, sha256: createHash("sha256").update(readFileSync(binary)).digest("hex") }));
    return binary;
  };
  const prepare = (tree: string, mode: string) => spawnSync("sh", [new URL("./inputs.sh", import.meta.url).pathname, mode, s.root, tree], { env: s.env, encoding: "utf8" });
  const oldBinary = publish(a);
  const oldReady = prepare(a, "lane");
  assert.equal(oldReady.status, 0, oldReady.stderr);
  const missing = prepare(b, "gate");
  assert.notEqual(missing.status, 0);
  assert.ok(missing.stderr.includes(`missing tsgo build ${frontendPin(b).key}`), missing.stderr);
  assert.ok(!existsSync(join(b, "target/tsgo")), "a missing key cannot fall back to main's frontend");
  const newBinary = publish(b);
  const newReady = prepare(b, "gate");
  assert.equal(newReady.status, 0, newReady.stderr);
  assert.equal(realpathSync(join(a, "target/tsgo")), oldBinary);
  assert.equal(realpathSync(join(b, "target/tsgo")), newBinary);
  assert.equal(run(s, join(a, "third_party/typescript-go"), ["rev-parse", "HEAD"]), old);
  assert.equal(run(s, join(b, "third_party/typescript-go"), ["rev-parse", "HEAD"]), next);
});

test("landing passes the gate tree's frontend instead of a caller override", async () => {
  const s = scratch();
  s.env.LAND_TEST_FRONTEND = "1";
  s.env.NTS_TSGO = "/wrong/frontend";
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
  assert.equal(gates(s), 5);
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
