// node --test tooling/lanes/branches.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inventory, markdown, parseStatus, parseWorktrees } from "./branches.ts";

test("inventory classifies replays and subjects, protects work, and leaves Git untouched", async () => {
  const parent = join(homedir(), ".cache/nts-scratch/branch-inventory");
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(join(parent, "test-")), repo = join(scratch, "repo");
  mkdirSync(repo);
  const env = { ...process.env, GIT_AUTHOR_NAME: "inventory-test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "inventory-test", GIT_COMMITTER_EMAIL: "test@example.invalid", GIT_AUTHOR_DATE: "2026-10-10T12:00:00Z", GIT_COMMITTER_DATE: "2026-10-10T12:00:00Z" };
  const git = (args: string[], cwd = repo) => {
    const r = spawnSync("git", ["-C", cwd, ...args], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const commit = (path: string, contents: string, subject: string) => {
    writeFileSync(join(repo, path), contents);
    git(["add", "--", path]); git(["commit", "-qm", subject]);
    return git(["rev-parse", "HEAD"]);
  };
  try {
    git(["init", "-q", "-b", "main"]);
    mkdirSync(join(repo, "tooling/lanes"), { recursive: true });
    writeFileSync(join(repo, "tooling/lanes/lanes.json"), JSON.stringify({ lanes: { compiler: { branch: "compiler/" }, wasm: { branch: "wasm/" }, jvm: { branch: "jvm/" } } }));
    writeFileSync(join(repo, ".gitignore"), "ignored\ntarget\n");
    writeFileSync(join(repo, "base"), "base\n");
    git(["add", "."]); git(["commit", "-qm", "base"]);
    commit("historical", "old patch\n", "historical patch");
    git(["rm", "-q", "historical"]); git(["commit", "-qm", "remove historical patch"]);
    const base = git(["rev-parse", "HEAD"]);
    git(["branch", "compiler/ancestor"]);
    git(["checkout", "-qb", "wasm/old-patch", base]);
    commit("historical", "old patch\n", "reapply before-base patch");
    git(["checkout", "-q", "main"]);
    git(["checkout", "-qb", "wasm/replay"]);
    const replay = commit("replay", "same patch\n", "land a replay");
    git(["checkout", "-q", "main"]);
    commit("unrelated", "advance main\n", "advance");
    git(["cherry-pick", replay]);
    assert.notEqual(git(["rev-parse", "HEAD"]), replay);
    git(["checkout", "-qb", "wasm/subject", base]);
    commit("subject-original", "old implementation\n", "amended landing");
    git(["checkout", "-q", "main"]);
    commit("subject-rewrite", "rewritten implementation\n", "amended landing");
    git(["checkout", "-qb", "jvm/unlanded", base]);
    commit("unlanded", "preserve me\n", "unlanded work");
    git(["branch", "compiler/old-unlanded"]);
    git(["branch", "sdk/old-unlanded"]);
    git(["branch", "mystery/old-unlanded"]);
    git(["checkout", "-qb", "wasm/recent", base]);
    env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = "2026-10-23T12:00:00Z";
    commit("recent", "new work\n", "recent work");
    git(["checkout", "-q", "main"]);
    const main = git(["rev-parse", "HEAD"]);
    git(["update-ref", "refs/archive/jvm/saved", main]); // Test setup only.
    writeFileSync(join(repo, ".gitmodules"), '[submodule "dep"]\npath = dep\nurl = ./unused\n');
    git(["add", ".gitmodules"]); git(["update-index", "--add", "--cacheinfo", `160000,${base},dep`]);
    git(["commit", "-qm", "submodule fixture"]);
    const dirty = join(scratch, "dirty"), clean = join(scratch, "clean"), active = join(scratch, "active");
    git(["worktree", "add", "-q", "-b", "compiler/dirty", dirty, main]);
    writeFileSync(join(dirty, "base"), "changed\n");
    writeFileSync(join(dirty, "untracked"), "not ignored\n");
    writeFileSync(join(dirty, "ignored"), "ignored\n");
    git(["worktree", "add", "-q", "--detach", clean, base]);
    git(["worktree", "add", "-q", "--detach", active, base]);
    const linked = join(scratch, "linked-submodule");
    git(["worktree", "add", "-q", "--detach", linked, "HEAD"]);
    rmSync(join(linked, "dep"), { recursive: true });
    symlinkSync(repo, join(linked, "dep"));
    writeFileSync(join(linked, "visible-untracked"), "still list this despite the submodule error\n");
    mkdirSync(join(repo, "target")); writeFileSync(join(repo, "target", "payload"), "allocated\n");
    symlinkSync(join(repo, "target"), join(clean, "target"));
    const beforeRefs = git(["show-ref"]), beforeTrees = git(["worktree", "list", "--porcelain"]);
    const indexes = [repo, dirty, clean, active, linked].map(tree => {
      const path = git(["rev-parse", "--path-format=absolute", "--git-path", "index"], tree);
      return { path, bytes: readFileSync(path), time: statSync(path).mtimeMs };
    });
    const r = await inventory({ repo, now: new Date("2026-10-23T20:00:00Z"), home: scratch, activeTrees: [active], protectedTree: repo });
    const branch = (name: string) => r.branches.find(b => b.name === name)!;
    assert.equal(branch("compiler/ancestor").stateOfLanding, "ANCESTOR");
    assert.equal(branch("compiler/ancestor").proposal.action, "delete branch");
    assert.equal(branch("wasm/replay").stateOfLanding, "LANDED");
    assert.equal(branch("wasm/replay").proposal.action, "delete branch");
    assert.equal(branch("wasm/old-patch").stateOfLanding, "UNLANDED", "A patch before the merge-base cannot prove landing");
    assert.equal(branch("wasm/subject").stateOfLanding, "PROBABLY-LANDED");
    assert.equal(branch("wasm/subject").proposal.action, "NEEDS A PERSON");
    assert.equal(branch("jvm/unlanded").stateOfLanding, "UNLANDED");
    assert.equal(branch("jvm/unlanded").unmatched[0].subject, "unlanded work");
    assert.equal(branch("jvm/unlanded").proposal.action, "archive then delete");
    assert.equal(branch("jvm/unlanded").proposal.archiveRef, "refs/archive/jvm/jvm/unlanded");
    assert.equal(branch("sdk/old-unlanded").proposal.action, "archive then delete");
    assert.equal(branch("compiler/old-unlanded").proposal.action, "NEEDS A PERSON");
    assert.equal(branch("mystery/old-unlanded").proposal.action, "NEEDS A PERSON");
    assert.equal(branch("wasm/recent").proposal.action, "keep");
    assert.equal(branch("compiler/dirty").proposal.action, "NEEDS A PERSON");
    const dw = r.worktrees.find(w => w.path === dirty)!;
    assert.equal(dw.dirty, true);
    assert.deepEqual(dw.untracked, ["untracked"]);
    assert.equal(dw.tracked[0].path, "base");
    assert.equal(dw.proposal.action, "NEEDS A PERSON");
    assert.equal(r.worktrees.find(w => w.path === clean)!.proposal.action, "remove worktree");
    assert.equal(r.worktrees.find(w => w.path === active)!.proposal.action, "keep");
    const lw = r.worktrees.find(w => w.path === linked)!;
    assert.equal(lw.dirty, true);
    assert.deepEqual(lw.untracked, ["visible-untracked"]);
    assert.ok(lw.errors.length > 0);
    assert.equal(lw.proposal.action, "NEEDS A PERSON");
    assert.equal(r.totals.uniqueTargetPaths, 1);
    assert.ok(r.totals.uniqueTargetBytes > 0);
    assert.equal(r.worktrees.find(w => w.path === clean)!.target.sharedWith[0], repo);
    assert.equal(r.totals.mainPatchIdPasses, 1);
    assert.deepEqual(r.warnings, []);
    assert.ok(markdown(r).indexOf("## Totals") < markdown(r).indexOf("## Branches"));
    assert.ok(markdown(r).includes("1c85129a-75a0-46a7-9b9f-ce8f8a834ba3"));
    assert.equal(git(["show-ref"]), beforeRefs);
    assert.equal(git(["worktree", "list", "--porcelain"]), beforeTrees);
    for (const index of indexes) {
      assert.deepEqual(readFileSync(index.path), index.bytes);
      assert.equal(statSync(index.path).mtimeMs, index.time);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("NUL parsers preserve unusual filenames and prunable worktrees", () => {
  assert.deepEqual(parseStatus(" M line\nname\0?? untracked | file\0R  new\0old\0"), {
    tracked: [{ status: " M", path: "line\nname" }, { status: "R ", path: "new", from: "old" }], untracked: ["untracked | file"],
  });
  const [w] = parseWorktrees("worktree /cache/path\nline\0HEAD abc\0detached\0prunable gitdir file points to non-existent location\0\0");
  assert.equal(w.path, "/cache/path\nline");
  assert.equal(w.detached, true);
  assert.match(w.prunable!, /non-existent/);
});
