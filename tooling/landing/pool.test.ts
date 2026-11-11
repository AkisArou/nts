import {fixtureEnvironment} from "../gate/test-environment.ts";
// The worktree pool, elastic: take (reusing a warm tree, else growing while
// the disk allows), give back, discard, release after landing, the upkeep that
// removes idle trees, and status.
//
//   node --test tooling/landing/pool.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLD_TARGET_BYTES, describePool, DISK_MARGIN_BYTES, IDLE_LIMIT_MS, Pool, PoolFull, pruneLines, statusJson, WARM_MINIMUM, type PoolOptions } from "./pool.ts";
import { scratchRepo } from "./scratch-repo.ts";

const GB = 2 ** 30, DAY = 86_400_000;
/** The tests' "now": git's clock and every idle time are read against it, never the machine's. */
const NOW = Date.parse("2026-11-06T12:00:00Z");

function pool(t: Parameters<typeof scratchRepo>[0], size = 2, options: PoolOptions = {}) {
  const s = scratchRepo(t, "landing-pool");
  // A tree's cargo target is ignored, as the repository's .gitignore has it.
  s.commit({ ".gitignore": "target/\n" }, "ignore targets");
  const linked: string[] = [];
  const inputs = (tree: string) => { linked.push(tree); };
  /** Git's clock `ago` ms before NOW, for what a tree did then. */
  const clock = (ago: number) => ({ ...s.env, GIT_COMMITTER_DATE: `@${Math.floor((NOW - ago) / 1000)} +0000` });
  const p = new Pool(join(s.dir, "pool"), { root: s.root, env: clock(0) }, inputs, { freeBytes: () => 1000 * GB, ...options });
  if (size) p.init(size);
  /** The same pool, `ago` ms before NOW. */
  const at = (ago: number) => new Pool(p.dir, { root: s.root, env: clock(ago) }, inputs, { freeBytes: () => 1000 * GB, ...options });
  /** Free tree `name` was last given back `ago` ms before NOW: a task's branch on it, then main again. */
  const freedAt = (name: string, ago: number) => {
    const cwd = join(p.dir, name), env = clock(ago);
    for (const args of [["switch", "-q", "-c", `task-${name}`], ["switch", "-q", "--detach", "refs/heads/main"], ["branch", "-q", "-D", `task-${name}`]]) execFileSync("git", args, { cwd, env });
  };
  return { s, p, linked, at, freedAt };
}
const names = (p: Pool) => p.trees().map(t => `${t.name} ${t.state}${t.branch ? ` ${t.branch}` : ""}`);

test("init prewarms the missing trees, detached at main, each with its inputs", t => {
  const { s, p, linked } = pool(t, 3);
  const trees = p.trees();
  assert.deepEqual(trees.map(t => `${t.name} ${t.state}`), ["1 free", "2 free", "3 free"]);
  assert.deepEqual(linked, trees.map(t => t.path));
  const main = s.git(["rev-parse", "main"]);
  assert.ok(trees.every(t => t.head === main && t.branch === null));
  p.init(3);
  assert.equal(linked.length, 3, "a tree that exists is left as it is");
  assert.throws(() => p.init(0), /a pool of 0 trees/);
});

test("a task takes a free tree on its branch at the newest main, keeps it, and the pool grows when every tree is held", t => {
  const { s, p, linked } = pool(t);
  const newer = s.commit({ "src/a.txt": "a\n" }, "main moved");
  const one = p.take("fix/a");
  assert.equal(one.name, "1");
  assert.equal(one.branch, "fix/a");
  assert.equal(s.git(["rev-parse", "fix/a"]), newer, "the branch starts at the newest main");
  assert.ok(existsSync(join(one.path, "src/a.txt")));
  assert.equal(linked.at(-1), one.path, "its inputs are linked again");
  assert.equal(p.take("fix/a").name, "1", "asking again is the same tree");
  assert.equal(p.take("fix/b").name, "2");
  // Every tree held: a new one, past what init made.
  const three = p.take("fix/c");
  assert.equal(three.name, "3");
  assert.equal(three.path, join(p.dir, "3"));
  assert.equal(s.git(["rev-parse", "fix/c"]), newer);
  assert.ok(linked.includes(three.path), "a new tree gets its inputs");
  assert.deepEqual(names(p), ["1 held fix/a", "2 held fix/b", "3 held fix/c"]);
  assert.throws(() => p.take("main"), /not a task branch/);
  // A task's branch that already exists is checked out as it is.
  s.git(["branch", "fix/old", "main~1"]);
  p.give("fix/b");
  const old = p.take("fix/old");
  assert.equal(old.name, "2", "a free tree before a new one");
  assert.equal(old.head, s.git(["rev-parse", "main~1"]));
  assert.equal(old.behind, 1);
});

test("a free tree with a warm target is taken before a cold one", t => {
  const { p } = pool(t, 3);
  mkdirSync(join(p.dir, "3", "target/release"), { recursive: true });
  assert.equal(p.take("fix/a").name, "3");
  assert.equal(p.take("fix/b").name, "1");
});

test("a branch checked out outside the pool is not taken", t => {
  const { s, p } = pool(t);
  s.git(["switch", "-q", "-c", "mine"]);
  assert.throws(() => p.take("mine"), /checked out in .* outside the pool/);
});

test("the pool grows only while the disk can hold another tree's target and the gate's floor, and says why not", t => {
  let free = 89 * GB, targets: Record<string, number> = {};
  const { p } = pool(t, 1, { freeBytes: () => free, targetBytes: tree => targets[tree] ?? null });
  p.take("fix/a");
  // One tree still to build keeps a cold build's worth: 25 GB of 89, and 65 more are needed.
  assert.equal(COLD_TARGET_BYTES, 25 * GB);
  assert.equal(DISK_MARGIN_BYTES, 40 * GB);
  const refused = (() => { try { p.take("fix/b"); } catch (error) { return error; } return null; })();
  assert.ok(refused instanceof PoolFull, String(refused));
  assert.equal(refused.room.reservedBytes, 25 * GB);
  assert.equal(refused.room.floorBytes, 65 * GB);
  assert.match(refused.message, /cannot host another tree: 89\.0 GB free, 25\.0 GB of it kept for 1 tree still to build; another tree needs 25\.0 GB for its target and 40\.0 GB must stay free beside it \(the gate's floor\), 65\.0 GB in all/);
  assert.deepEqual(names(p), ["1 held fix/a"], "nothing was made");
  free = 90 * GB;
  assert.equal(p.take("fix/b").name, "2");
  // Measured from the pool's own targets: the largest one is what a tree needs.
  targets = { [join(p.dir, "1")]: 40 * GB };
  free = 119 * GB;
  assert.throws(() => p.take("fix/c"), (error: unknown) => error instanceof PoolFull && error.room.treeBytes === 40 * GB && error.room.reservedBytes === 40 * GB);
  free = 120 * GB;
  assert.equal(p.take("fix/c").name, "3");
  // A free tree is reused whatever the disk says: it needs no new target.
  p.give("fix/a");
  free = 0;
  assert.equal(p.take("fix/d").name, "1");
});

test("giving a tree back detaches it at main, keeps the branch and the target; uncommitted work refuses it", t => {
  const { s, p } = pool(t);
  const tree = p.take("fix/a");
  const work = s.commit({ "src/w.txt": "work\n" }, "work", tree.path);
  writeFileSync(join(tree.path, "src/w.txt"), "unsaved\n");
  assert.throws(() => p.give("fix/a"), /uncommitted changes, kept: .*src\/w.txt.*--discard/);
  assert.equal(readFileSync(join(tree.path, "src/w.txt"), "utf8"), "unsaved\n", "nothing was touched");
  writeFileSync(join(tree.path, "src/w.txt"), "work\n");
  mkdirSync(join(tree.path, "target"), { recursive: true });
  writeFileSync(join(tree.path, "target/built"), "warm\n");
  const given = p.give("fix/a");
  assert.equal(given.tree.state, "free");
  assert.equal(given.tree.head, s.git(["rev-parse", "main"]));
  assert.deepEqual(given.branch, [], "the branch is not touched");
  assert.equal(s.git(["rev-parse", "fix/a"]), work, "the task's branch keeps its work");
  assert.ok(existsSync(join(tree.path, "target/built")), "the target stays warm");
  assert.throws(() => p.give("nothing"), /no pool tree is nothing/);
});

test("give --discard drops the task: its uncommitted work and its branch, here and on origin, and keeps the tree warm", t => {
  const { s, p } = pool(t);
  const a = p.take("fix/a");
  s.commit({ "src/a.txt": "dropped\n" }, "work to drop", a.path);
  s.git(["push", "-q", "origin", "fix/a"], a.path);
  writeFileSync(join(a.path, "notes.txt"), "untracked\n");
  mkdirSync(join(a.path, "target"), { recursive: true });
  writeFileSync(join(a.path, "target/built"), "warm\n");
  const dropped = p.give("fix/a", { discard: true });
  assert.equal(dropped.tree.state, "free");
  assert.equal(dropped.tree.head, s.git(["rev-parse", "main"]));
  assert.deepEqual(dropped.branch.map(b => `${b.where} ${b.state}`), ["local deleted", "remote deleted"]);
  assert.equal(s.git(["branch", "--list", "fix/a"]), "");
  assert.equal(s.git(["ls-remote", "--heads", "origin", "fix/a"]), "");
  assert.ok(!existsSync(join(a.path, "notes.txt")), "its uncommitted work is dropped");
  assert.ok(existsSync(join(a.path, "target/built")), "its target stays warm");
  // origin moved past the tip given back: that work is not this task's to drop.
  const b = p.take("fix/b");
  const tip = s.commit({ "src/b.txt": "b\n" }, "b", b.path);
  s.git(["push", "-q", "origin", "fix/b"], b.path);
  const beyond = s.git(["commit-tree", "-p", tip, "-m", "pushed from elsewhere", `${tip}^{tree}`]);
  s.git(["push", "-q", "origin", `${beyond}:refs/heads/fix/b`]);
  const kept = p.give("fix/b", { discard: true });
  assert.deepEqual(kept.branch.map(o => `${o.where} ${o.state}`), ["local deleted", "remote kept"]);
  assert.match(kept.branch[1]!.reason ?? "", new RegExp(`origin/fix/b is at ${beyond.slice(0, 12)}, with commits ${tip.slice(0, 12)} does not have`));
  assert.equal(s.git(["ls-remote", "--heads", "origin", "fix/b"]).split("\t")[0], beyond);
});

test("after its task lands, the tree is reset to the new main, unless it holds uncommitted work", t => {
  const { s, p } = pool(t);
  const a = p.take("fix/a"), b = p.take("fix/b");
  s.commit({ "src/landed.txt": "landed\n" }, "landed");
  const released = p.release("fix/a", a.head);
  assert.equal(released.state, "reset");
  assert.equal(released.tree?.head, s.git(["rev-parse", "main"]));
  assert.ok(existsSync(join(a.path, "src/landed.txt")));
  writeFileSync(join(b.path, "left.txt"), "left behind\n");
  const kept = p.release("fix/b", b.head);
  assert.equal(kept.state, "kept");
  assert.match(kept.reason ?? "", /uncommitted changes: \?\? left.txt; it stays on its branch, and the next upkeep resets it once they are gone and nothing uses it/);
  assert.equal(p.release("fix/none", b.head).state, "none");
  const status = describePool(p.trees(), NOW);
  assert.match(status, / 1 {2}\S+ {2}free, idle 0m/);
  assert.match(status, / 2 {2}\S+ {2}landed fix\/b \(1 behind\), 1 uncommitted, idle 0m/);
  // Its work left: the upkeep keeps it, and resets it once the work is gone.
  assert.match(pruneLines(p.prune({ now: NOW }), NOW).join("\n"), /^pool: kept tree 2 on its landed branch fix\/b: it has uncommitted changes: \?\? left.txt$/m);
  rmSync(join(b.path, "left.txt"));
  const settled = p.prune({ now: NOW });
  assert.deepEqual(settled.released.map(r => `${r.tree.name} ${r.branch}: ${r.outcome.map(o => `${o.where} ${o.state}`).join(", ")}`), ["2 fix/b: local deleted"]);
  assert.deepEqual(names(p), ["1 free", "2 free"]);
  assert.equal(p.landed().size, 0, "its mark goes with it");
});

test("a tree a process still uses stays on its landed branch, says what uses it, and the upkeep resets it once nothing does", async t => {
  const { s, p } = pool(t);
  const a = p.take("fix/a");
  const tip = s.commit({ "src/a.txt": "the task's change\n" }, "the task's change", a.path);
  // An agent's test, or a person's shell, with its working directory in the tree.
  const shell = spawn("cat", [], {env:fixtureEnvironment(t), cwd: join(a.path, "src"), stdio: ["pipe", "ignore", "ignore"] });
  // Ended when its input closes, here or, if an assertion stops the test first, after it.
  t.after(() => { shell.stdin.end(); });
  await once(shell, "spawn");
  s.commit({ "src/landed.txt": "landed\n" }, "landed");
  const kept = p.release("fix/a", tip);
  assert.equal(kept.state, "kept");
  assert.equal(kept.reason, `pool tree 1 stays on its branch while pid ${shell.pid} cat (its working directory) still uses it `
    + "(a shell or editor with its working directory there counts too); the next upkeep resets it once nothing does");
  assert.deepEqual(names(p), ["1 landed fix/a", "2 free"]);
  assert.equal(p.landed().get("fix/a"), tip, "marked landed at the commit that landed");
  assert.match(describePool(p.trees(), NOW), new RegExp(` 1 {2}\\S+ {2}landed fix/a \\(1 ahead of main, 1 behind\\), kept while pid ${shell.pid} cat \\(its working directory\\) still uses it, idle 0m`));
  assert.throws(() => s.git(["branch", "-D", "fix/a"]), /checked out|used by worktree/, "its branch stays with its tree");
  const waiting = p.prune({ now: NOW });
  assert.deepEqual(waiting.released, []);
  assert.deepEqual(pruneLines(waiting, NOW), [`pool: kept tree 1 on its landed branch fix/a: pid ${shell.pid} cat (its working directory) still uses it (a shell or editor with its working directory there counts too)`]);
  assert.equal(p.take("fix/b").name, "2", "a landed tree is not free");
  shell.stdin.end(); await once(shell, "exit");
  assert.match(describePool(p.trees(), NOW), / 1 {2}\S+ {2}landed fix\/a \(1 ahead of main, 1 behind\), reset at the next upkeep, idle 0m/);
  const settled = p.prune({ now: NOW });
  assert.deepEqual(settled.released.map(r => `${r.tree.name} ${r.branch}: ${r.outcome.map(o => `${o.where} ${o.state}`).join(", ")}`), ["1 fix/a: local deleted"]);
  assert.match(pruneLines(settled, NOW)[0]!, /^pool: reset tree 1, whose task fix\/a landed, now that nothing uses it; its branch here deleted$/);
  assert.deepEqual(names(p), ["1 free", "2 held fix/b"]);
  assert.equal(p.trees()[0]!.head, s.git(["rev-parse", "main"]), "at the newest main");
  assert.equal(p.landed().size, 0);
});

test("a landed branch that moves on is its task's again: its mark goes and its tree stays held", async t => {
  const { s, p } = pool(t);
  const a = p.take("fix/a");
  const shell = spawn("cat", [], {env:fixtureEnvironment(t), cwd: a.path, stdio: ["pipe", "ignore", "ignore"] });
  await once(shell, "spawn");
  try {
    assert.equal(p.release("fix/a", a.head).state, "kept");
    assert.deepEqual(names(p), ["1 landed fix/a", "2 free"]);
    s.commit({ "src/next.txt": "the next slice\n" }, "the next slice", a.path);
    assert.deepEqual(names(p), ["1 held fix/a", "2 free"], "a new commit: the task goes on");
    p.prune({ now: NOW });
    assert.equal(p.landed().size, 0, "the upkeep drops the mark");
    // A landing of a commit its tree has gone past leaves the tree as it is, unmarked.
    const past = p.release("fix/a", a.head);
    assert.deepEqual([past.state, past.reason], ["kept", "pool tree 1 has commits past the one that landed, so it stays its task's"]);
    assert.deepEqual([names(p), p.landed().size], [["1 held fix/a", "2 free"], 0]);
    // Asked for again, a landed task's tree is its own again too.
    const tip = s.git(["rev-parse", "HEAD"], a.path);
    assert.equal(p.release("fix/a", tip).state, "kept");
    assert.equal(p.take("fix/a").state, "held");
    assert.equal(p.landed().size, 0);
  } finally { shell.stdin.end(); await once(shell, "exit"); }
  assert.equal(s.git(["rev-parse", "--abbrev-ref", "HEAD"], a.path), "fix/a");
});

test("the upkeep removes free trees idle past the limit, cold ones first, keeps the warm minimum, and never touches a held or dirty tree", t => {
  assert.equal(IDLE_LIMIT_MS, 3 * DAY);
  assert.equal(WARM_MINIMUM, 2);
  const { s, p, at, freedAt } = pool(t, 0);
  at(6 * DAY).init(6);
  // 1: held since six days ago; 2 and 3: free for five days, 2 warm and 3 cold; 4: free for four days, warm;
  // 5: free since now, warm; 6: detached with work nobody committed, for five days.
  at(6 * DAY).take("fix/held");
  for (const n of ["2", "4", "5"]) mkdirSync(join(p.dir, n, "target/release"), { recursive: true });
  freedAt("2", 5 * DAY); freedAt("3", 5 * DAY); freedAt("4", 4 * DAY); freedAt("5", 0); freedAt("6", 5 * DAY);
  writeFileSync(join(p.dir, "6", "uncommitted.txt"), "nobody committed this\n");
  // A sealed folder in a removed tree's target: its write permission comes back before it goes.
  mkdirSync(join(p.dir, "2", "target/sealed/inner"), { recursive: true });
  writeFileSync(join(p.dir, "2", "target/sealed/inner/file"), "read-only\n");
  chmodSync(join(p.dir, "2", "target/sealed/inner"), 0o555); chmodSync(join(p.dir, "2", "target/sealed"), 0o555);
  assert.deepEqual(names(p), ["1 held fix/held", "2 free", "3 free", "4 free", "5 free", "6 dirty"]);

  const pruned = p.prune({ now: NOW });
  assert.deepEqual(pruned.removed.map(r => r.tree.name), ["3", "2"], "the cold one first, then the longest idle");
  assert.deepEqual(pruned.kept, []);
  assert.equal(pruned.free, 2);
  assert.deepEqual(names(p), ["1 held fix/held", "4 free", "5 free", "6 dirty"], "two free trees stay warm");
  for (const n of ["2", "3"]) assert.ok(!existsSync(join(p.dir, n)), `tree ${n}'s folder and target are gone`);
  const registered = s.git(["worktree", "list", "--porcelain"]);
  assert.ok(!registered.includes(join(p.dir, "2")) && !registered.includes(join(p.dir, "3")), registered);
  assert.equal(s.git(["rev-parse", "--abbrev-ref", "HEAD"], join(p.dir, "1")), "fix/held", "the held tree is untouched");
  assert.equal(readFileSync(join(p.dir, "6", "uncommitted.txt"), "utf8"), "nobody committed this\n", "the dirty tree too");
  assert.match(pruneLines(pruned, NOW).join("\n"), /pool: removed tree 3, free and idle 5d 0h\npool: removed tree 2, free and idle 5d 0h, with its 0\.0 GB target\npool: 2 free trees kept warm/);
  // Nothing more to do: tree 4 is idle past the limit, but the minimum holds it.
  assert.deepEqual(p.prune({ now: NOW }).removed, []);
  // A lower minimum lets it go; the recent one stays.
  assert.deepEqual(p.prune({ keep: 1, now: NOW }).removed.map(r => r.tree.name), ["4"]);
  assert.deepEqual(names(p), ["1 held fix/held", "5 free", "6 dirty"]);
  // The next tree a task needs takes the lowest free number again.
  p.take("fix/next"); assert.equal(p.take("fix/later").name, "2");
});

test("status shows each tree's state, task, idle time and target size, for a scheduler too", t => {
  const { p } = pool(t, 2, { targetBytes: tree => tree.endsWith("/1") ? 24 * GB : null });
  p.take("fix/a");
  const trees = p.measured(), room = p.room(trees);
  const text = describePool(trees, NOW);
  assert.match(text, / 1 {2}\S+ {2}task fix\/a, idle 0m, target 24\.0 GB/);
  assert.match(text, / 2 {2}\S+ {2}free, idle 0m, no target/);
  const json = statusJson(p.dir, trees, room, NOW);
  assert.equal(json.version, 1);
  assert.equal(json.room.ok, true);
  assert.equal(json.room.tree_bytes, COLD_TARGET_BYTES, "24 GB measured is less than one cold build");
  assert.equal(json.room.unbuilt, 1);
  assert.deepEqual(json.trees.map(tree => [tree.name, tree.state, tree.task, tree.target_bytes]), [["1", "held", "fix/a", 24 * GB], ["2", "free", null, null]]);
  assert.deepEqual(json.trees.map(tree => tree.idle_ms), [0, 0], "both trees moved at NOW");
});
