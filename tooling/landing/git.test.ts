// The git half of landing: rebase, fast-forward, push, branch deletion.
//
//   node --test tooling/landing/git.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { advanceMain, changedPaths, deleteBranch, openPullBases, pushedMain, pushMain, rebaseOnto, worktrees, type Git } from "./git.ts";
import { scratchRepo } from "./scratch-repo.ts";

test("a change is replayed onto the newest main, skipping what main already has", t => {
  const s = scratchRepo(t), git: Git = { root: s.root, env: s.env };
  const base = s.git(["rev-parse", "HEAD"]);
  s.git(["switch", "-q", "-c", "task"]);
  const fixture = s.commit({ "tests/a.txt": "fixture\n" }, "fixture");
  const fix = s.commit({ "src/fix.txt": "fix\n" }, "fix");
  s.git(["switch", "-q", "main"]);
  s.commit({ "docs/other.md": "another landing\n" }, "another landing");
  s.git(["cherry-pick", fixture]); // the fixture landed on its own, as a copy
  const main = s.git(["rev-parse", "HEAD"]);
  const rebased = rebaseOnto(git, main, fix);
  assert.ok("tip" in rebased, JSON.stringify(rebased));
  assert.equal(rebased.replayed, 1);
  assert.equal(rebased.skipped, 1);
  assert.equal(s.git(["rev-parse", `${rebased.tip}^`]), main);
  assert.equal(s.git(["log", "-1", "--format=%an %s", rebased.tip]), "Agent fix", "the author and message are the change's");
  assert.deepEqual(changedPaths(git, main, rebased.tip), ["src/fix.txt"]);
  assert.deepEqual(rebaseOnto(git, base, fix), { tip: fix, replayed: 0, skipped: 0 }, "already on main's line: nothing to replay");
});

test("a conflict refuses the change and names the files it conflicts in", t => {
  const s = scratchRepo(t), git: Git = { root: s.root, env: s.env };
  s.git(["switch", "-q", "-c", "task"]);
  const change = s.commit({ "docs/workflow.md": "the task's words\n", "src/new.txt": "new\n" }, "task");
  s.git(["switch", "-q", "main"]);
  const main = s.commit({ "docs/workflow.md": "main's words\n" }, "main moved");
  const rebased = rebaseOnto(git, main, change);
  assert.deepEqual(rebased, { conflict: change, files: ["docs/workflow.md"] });
});

test("a merge on the branch is refused: a task's branch is a line of commits", t => {
  const s = scratchRepo(t), git: Git = { root: s.root, env: s.env };
  s.git(["switch", "-q", "-c", "task"]);
  s.commit({ "a.txt": "a\n" }, "a");
  s.git(["switch", "-q", "-c", "side", "main"]);
  s.commit({ "b.txt": "b\n" }, "b");
  s.git(["switch", "-q", "task"]);
  s.git(["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
  const tip = s.git(["rev-parse", "HEAD"]);
  s.git(["switch", "-q", "main"]);
  const main = s.commit({ "c.txt": "c\n" }, "c");
  const rebased = rebaseOnto(git, main, tip);
  assert.ok("conflict" in rebased && /merge/.test(rebased.reason ?? ""), JSON.stringify(rebased));
});

test("main moves only from the base it was checked on, and its checkout moves with it", t => {
  const s = scratchRepo(t), git: Git = { root: s.root, env: s.env };
  const base = s.git(["rev-parse", "HEAD"]);
  s.git(["switch", "-q", "-c", "task"]);
  const tip = s.commit({ "src/x.txt": "x\n" }, "x");
  s.git(["switch", "-q", "--detach", base]);
  s.git(["worktree", "add", "-q", join(s.dir, "main-tree"), "main"]); // main is checked out elsewhere
  assert.deepEqual(advanceMain(git, base, tip), { ok: true, via: join(s.dir, "main-tree") });
  assert.equal(readFileSync(join(s.dir, "main-tree/src/x.txt"), "utf8"), "x\n", "the checkout is at the new main");
  assert.deepEqual(advanceMain(git, base, tip), { ok: false, moved: tip }, "a stale base is a moved main");
  const later = s.commit({ "src/y.txt": "y\n" }, "y", join(s.dir, "main-tree"));
  writeFileSync(join(s.dir, "main-tree/src/y.txt"), "an uncommitted edit\n");
  s.git(["switch", "-q", "--detach", later]);
  const next = s.commit({ "src/y.txt": "y2\n" }, "y2");
  const blocked = advanceMain(git, later, next);
  assert.ok(!blocked.ok && "blocked" in blocked, JSON.stringify(blocked));
  assert.equal(s.git(["rev-parse", "main"]), later, "a refused fast-forward leaves main where it was");
  // With main checked out nowhere, the ref moves by compare-and-swap.
  s.git(["checkout", "-q", "--", "src/y.txt"], join(s.dir, "main-tree"));
  s.git(["switch", "-q", "--detach"], join(s.dir, "main-tree"));
  assert.deepEqual(advanceMain(git, later, next), { ok: true, via: "refs/heads/main" });
  assert.equal(s.git(["rev-parse", "main"]), next);
  assert.ok(worktrees(git).every(w => w.branch !== "main"));
});

test("main is pushed, never forced", t => {
  const s = scratchRepo(t), git: Git = { root: s.root, env: s.env };
  s.commit({ "src/a.txt": "a\n" }, "a");
  assert.equal(pushedMain(git, "origin"), false);
  assert.deepEqual(pushMain(git, "origin"), { ok: true });
  assert.equal(pushedMain(git, "origin"), true);
  // Someone pushed to origin directly: the push is rejected and says so.
  const other = join(s.dir, "other");
  s.git(["clone", "-q", s.origin, other], s.dir);
  s.commit({ "src/b.txt": "elsewhere\n" }, "elsewhere", other);
  s.git(["push", "-q", "origin", "main"], other);
  s.commit({ "src/c.txt": "here\n" }, "here");
  const pushed = pushMain(git, "origin");
  assert.ok(!pushed.ok && /rejected|fetch first|non-fast-forward/.test(pushed.reason), JSON.stringify(pushed));
});

test("a landed branch is deleted here and on origin, unless it holds more than landed", t => {
  const s = scratchRepo(t), git: Git = { root: s.root, env: s.env };
  s.git(["switch", "-q", "-c", "fix/a"]);
  const submitted = s.commit({ "src/a.txt": "a\n" }, "a");
  s.git(["push", "-q", "origin", "fix/a"]);
  s.git(["switch", "-q", "main"]);
  assert.deepEqual(deleteBranch(git, "fix/a", submitted, "origin"), [{ where: "local", state: "deleted" }, { where: "remote", state: "deleted" }]);
  assert.equal(s.git(["ls-remote", "--heads", "origin", "fix/a"]), "");
  assert.deepEqual(deleteBranch(git, "fix/a", submitted, "origin"), [{ where: "local", state: "absent" }, { where: "remote", state: "absent" }]);

  // Moved on after it was submitted: its new work stays, here and there.
  s.git(["switch", "-q", "-c", "fix/b"]);
  const b = s.commit({ "src/b.txt": "b\n" }, "b");
  s.commit({ "src/b.txt": "b, more\n" }, "b, more");
  s.git(["push", "-q", "origin", "fix/b"]);
  s.git(["switch", "-q", "main"]);
  const kept = deleteBranch(git, "fix/b", b, "origin");
  assert.deepEqual(kept.map(o => `${o.where} ${o.state}`), ["local kept", "remote kept"]);

  // Checked out in a tree: kept until the tree is freed.
  s.git(["switch", "-q", "-c", "fix/c"]);
  const c = s.commit({ "src/c.txt": "c\n" }, "c");
  const held = deleteBranch(git, "fix/c", c, null);
  assert.deepEqual(held, [{ where: "local", state: "kept", reason: `checked out in ${s.root}` }]);
  assert.throws(() => deleteBranch(git, "main", c, null), /not a task branch/);
});

test("a branch an open pull request is based on stays on the remote, and so does one when pull requests cannot be read", t => {
  const s = scratchRepo(t), git: Git = { root: s.root, env: s.env };
  s.git(["switch", "-q", "-c", "fix/base"]);
  const submitted = s.commit({ "src/base.txt": "base\n" }, "base");
  s.git(["push", "-q", "origin", "fix/base"]);
  s.git(["switch", "-q", "main"]);
  const stacked = deleteBranch(git, "fix/base", submitted, "origin", { read: new Map([["fix/base", [71, 72]], ["main", [9]]]) });
  assert.deepEqual(stacked, [{ where: "local", state: "deleted" }, { where: "remote", state: "kept", reason: "open pull request #71, #72 are based on it" }]);
  assert.notEqual(s.git(["ls-remote", "--heads", "origin", "fix/base"]), "", "deleting it would close #71 and #72");
  const unread = deleteBranch(git, "fix/base", submitted, "origin", { unreadable: "cannot list open pull requests: offline" });
  assert.deepEqual(unread.at(-1), { where: "remote", state: "kept", reason: "cannot list open pull requests: offline" });
  // A remote that is not on GitHub has no pull requests: the scratch origin is a bare directory.
  assert.deepEqual(openPullBases(git, "origin"), { read: new Map() });
  assert.deepEqual(deleteBranch(git, "fix/base", submitted, "origin").at(-1), { where: "remote", state: "deleted" });
});
