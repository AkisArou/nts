// The worktree pool: take, give back, release after landing, status.
//
//   node --test tooling/landing/pool.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describePool, Pool } from "./pool.ts";
import { scratchRepo } from "./scratch-repo.ts";

function pool(t: Parameters<typeof scratchRepo>[0], size = 2) {
  const s = scratchRepo(t, "landing-pool");
  const linked: string[] = [];
  const p = new Pool(join(s.dir, "pool"), { root: s.root, env: s.env }, tree => { linked.push(tree); });
  p.init(size);
  return { s, p, linked };
}

test("init makes the missing trees, detached at main, each with its inputs", t => {
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

test("a task takes a free tree on its branch at the newest main, and keeps it", t => {
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
  assert.throws(() => p.take("fix/c"), /no free tree: 1 held \(fix\/a\), 2 held \(fix\/b\)/);
  assert.throws(() => p.take("main"), /not a task branch/);
  // A task's branch that already exists is checked out as it is.
  s.git(["branch", "fix/old", "main~1"]);
  p.give("fix/b");
  const old = p.take("fix/old");
  assert.equal(old.head, s.git(["rev-parse", "main~1"]));
  assert.equal(old.behind, 1);
});

test("a branch checked out outside the pool is not taken", t => {
  const { s, p } = pool(t);
  s.git(["switch", "-q", "-c", "mine"]);
  assert.throws(() => p.take("mine"), /checked out in .* outside the pool/);
});

test("giving a tree back detaches it at main and keeps the branch; uncommitted work refuses it", t => {
  const { s, p } = pool(t);
  const tree = p.take("fix/a");
  const work = s.commit({ "src/w.txt": "work\n" }, "work", tree.path);
  writeFileSync(join(tree.path, "src/w.txt"), "unsaved\n");
  writeFileSync(join(tree.path, "notes.txt"), "untracked\n");
  assert.throws(() => p.give("fix/a"), /uncommitted changes, kept: .*src\/w.txt/);
  assert.equal(readFileSync(join(tree.path, "src/w.txt"), "utf8"), "unsaved\n", "nothing was touched");
  const freed = p.give("1", { discard: true });
  assert.equal(freed.state, "free");
  assert.equal(freed.head, s.git(["rev-parse", "main"]));
  assert.ok(!existsSync(join(tree.path, "notes.txt")));
  assert.equal(s.git(["rev-parse", "fix/a"]), work, "the task's branch keeps its work");
  assert.throws(() => p.give("nothing"), /no pool tree is nothing/);
});

test("after its task lands, the tree is reset to the new main, unless it holds uncommitted work", t => {
  const { s, p } = pool(t);
  const a = p.take("fix/a"), b = p.take("fix/b");
  s.commit({ "src/landed.txt": "landed\n" }, "landed");
  const released = p.release("fix/a");
  assert.equal(released.state, "reset");
  assert.equal(released.tree?.head, s.git(["rev-parse", "main"]));
  assert.ok(existsSync(join(a.path, "src/landed.txt")));
  writeFileSync(join(b.path, "left.txt"), "left behind\n");
  const kept = p.release("fix/b");
  assert.equal(kept.state, "kept");
  assert.match(kept.reason ?? "", /uncommitted changes: \?\? left.txt/);
  assert.equal(p.release("fix/none").state, "none");
  const status = describePool(p.trees());
  assert.match(status, / 1 {2}\S+ {2}free/);
  assert.match(status, / 2 {2}\S+ {2}task fix\/b \(1 behind\), 1 uncommitted/);
});
