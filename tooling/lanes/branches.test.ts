// node --test tooling/lanes/branches.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildOutput, inputFor, inventory, markdown, parseDiffstats, parseStatus, parseWorktrees } from "./branches.ts";

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
    writeFileSync(join(repo, "tooling/lanes/lanes.json"), JSON.stringify({ lanes: { compiler: { branch: "compiler/" }, wasm: { branch: "wasm/" }, jvm: { branch: "jvm/" }, tsrs: { branch: "tsrs/" } } }));
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
    for (const name of ["archive/compiler-helper/old", "bench/old", "exp/old", "keep/old", "docs/old", "runtime/old", "worktree-agent-old", "tsrs/old"]) git(["branch", name]);
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
    mkdirSync(join(dirty, "out")); mkdirSync(join(dirty, "results/benchmarks"), { recursive: true });
    for (const path of ["artifact.o", "artifact.obj", "out/generated", "results/benchmarks/timing"]) writeFileSync(join(dirty, path), "throwaway\n");
    git(["worktree", "add", "-q", "--detach", clean, base]);
    git(["worktree", "add", "-q", "--detach", active, base]);
    const linked = join(scratch, "linked-submodule");
    git(["worktree", "add", "-q", "--detach", linked, "HEAD"]);
    rmSync(join(linked, "dep"), { recursive: true });
    symlinkSync(repo, join(linked, "dep"));
    writeFileSync(join(linked, "visible-untracked"), "still list this despite the submodule error\n");
    // These entries are external INPUTS, not uncommitted work. An internal
    // symlink is still work and must be snapshotted.
    symlinkSync(repo, join(clean, "node_modules"));
    mkdirSync(join(clean, "third_party")); symlinkSync(repo, join(clean, "third_party/chromium"));
    symlinkSync("base", join(dirty, "internal-link"));
    assert.equal(inputFor(dirty, "internal-link"), null);
    assert.ok(inputFor(clean, "third_party/chromium/base"));
    const lane = join(scratch, "Projects/nts-lanes/jvm");
    mkdirSync(join(scratch, "Projects/nts-lanes"), { recursive: true });
    git(["worktree", "add", "-q", "-b", "jvm/home", lane, main]);
    writeFileSync(join(lane, "resume-work"), "keep the paused lane home\n");
    const stale = join(scratch, "gone");
    git(["worktree", "add", "-q", "-b", "jvm/stale", stale, base]);
    rmSync(stale, { recursive: true });
    const checkedRecent = join(scratch, "checked-recent");
    git(["worktree", "add", "-q", "-b", "jvm/checked-recent", checkedRecent, "wasm/recent"]);
    const collisions = [join(scratch, "one/collision"), join(scratch, "two/collision")];
    for (const tree of collisions) {
      mkdirSync(join(tree, ".."), { recursive: true });
      git(["worktree", "add", "-q", "--detach", tree, base]);
      writeFileSync(join(tree, "base"), `unsaved work from ${tree}\n`);
    }
    mkdirSync(join(repo, "target")); writeFileSync(join(repo, "target", "payload"), "allocated\n");
    mkdirSync(join(dirty, "target")); writeFileSync(join(dirty, "target", "payload"), "own target allocation\n");
    symlinkSync(join(repo, "target"), join(clean, "target"));
    const beforeRefs = git(["show-ref"]), beforeTrees = git(["worktree", "list", "--porcelain"]);
    const indexes = [repo, dirty, clean, active, linked, lane, checkedRecent, ...collisions].map(tree => {
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
    assert.equal(branch("wasm/subject").proposal.action, "archive then delete");
    assert.deepEqual(branch("wasm/subject").unmatchedDiffstat, { files: 1, insertions: 1, deletions: 0, binaryFiles: 0 });
    assert.equal(branch("jvm/unlanded").stateOfLanding, "UNLANDED");
    assert.equal(branch("jvm/unlanded").unmatched[0].subject, "unlanded work");
    assert.deepEqual(branch("jvm/unlanded").unmatched[0].diffstat, { files: 1, insertions: 1, deletions: 0, binaryFiles: 0 });
    assert.equal(branch("jvm/unlanded").proposal.action, "archive then delete");
    assert.equal(branch("jvm/unlanded").proposal.archiveRef, "refs/archive/jvm/jvm/unlanded");
    assert.equal(branch("sdk/old-unlanded").proposal.action, "archive then delete");
    assert.equal(branch("compiler/old-unlanded").proposal.action, "archive then delete");
    for (const name of ["archive/compiler-helper/old", "bench/old", "exp/old", "keep/old", "docs/old", "runtime/old", "worktree-agent-old"]) {
      assert.equal(branch(name).lane, "compiler"); assert.equal(branch(name).proposal.action, "archive then delete");
    }
    assert.equal(branch("tsrs/old").proposal.action, "NEEDS A PERSON");
    assert.equal(branch("mystery/old-unlanded").proposal.action, "NEEDS A PERSON");
    assert.equal(branch("wasm/recent").proposal.action, "keep");
    assert.equal(branch("compiler/dirty").proposal.action, "delete branch");
    assert.deepEqual(branch("compiler/dirty").effectiveCheckouts, []);
    assert.deepEqual(branch("compiler/dirty").retiringCheckouts, [dirty]);
    assert.equal(branch("jvm/checked-recent").proposal.action, "archive then delete");
    assert.equal(branch("jvm/stale").proposal.action, "delete branch");
    assert.equal(branch("jvm/home").proposal.action, "keep");
    const dw = r.worktrees.find(w => w.path === dirty)!;
    assert.equal(dw.dirty, true);
    assert.deepEqual(dw.snapshotFiles.untracked, ["internal-link", "untracked"]);
    assert.equal(dw.buildOutputs.length, 4);
    assert.equal(dw.tracked[0].path, "base");
    assert.equal(dw.proposal.action, "snapshot then remove");
    assert.equal(dw.proposal.archiveRef, "refs/archive/compiler/snapshot/dirty");
    assert.equal(r.worktrees.find(w => w.path === clean)!.proposal.action, "remove worktree");
    assert.equal(r.worktrees.find(w => w.path === active)!.proposal.action, "keep");
    const lw = r.worktrees.find(w => w.path === linked)!;
    assert.equal(lw.dirty, true);
    assert.deepEqual(lw.untracked, ["visible-untracked"]);
    assert.equal(lw.errors.length, 0);
    assert.equal(lw.inputs[0].path, "dep");
    assert.equal(lw.proposal.action, "snapshot then remove");
    const cw = r.worktrees.find(w => w.path === clean)!;
    assert.equal(cw.dirty, false);
    assert.equal(cw.inputs.length, 2);
    assert.equal(r.worktrees.find(w => w.path === lane)!.proposal.action, "keep");
    assert.equal(r.worktrees.find(w => w.path === lane)!.dirty, true);
    assert.equal(r.worktrees.find(w => w.path === stale)!.proposal.action, "prune stale registration");
    for (const tree of collisions) assert.match(r.worktrees.find(w => w.path === tree)!.proposal.reason, /Archive destination collision/);
    assert.equal(r.totals.uniqueTargetPaths, 2);
    assert.ok(r.totals.uniqueTargetBytes > 0);
    assert.equal(r.worktrees.find(w => w.path === clean)!.target.sharedWith[0], repo);
    assert.equal(r.totals.mainPatchIdPasses, 1);
    assert.equal(r.summary.reduce((s, row) => s + row.targetFreedBytes, 0), dw.target.bytes, "Only the retiring tree's own target is freed; the target shared with protected main is not freed");
    assert.ok(dw.target.bytes! > 0);
    assert.equal(r.totals.missingWorktrees, 1);
    assert.equal(r.totals.inaccessibleOrIncompleteWorktrees, 0);
    assert.deepEqual(r.warnings, []);
    assert.ok(markdown(r).indexOf("## Totals") < markdown(r).indexOf("## Branches"));
    assert.ok(markdown(r).indexOf("## Proposed actions") < markdown(r).indexOf("## Really dirty trees"));
    assert.ok(markdown(r).indexOf("## Really dirty trees") < markdown(r).indexOf("## Ten largest unlanded series"));
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
  const sha = "a".repeat(40);
  assert.deepEqual(parseDiffstats(`${sha}\0\n2\t3\tpath\nwith\ttabs\0-\t-\timage\0`).get(sha), {
    stat: { files: 2, insertions: 2, deletions: 3, binaryFiles: 1 }, paths: ["path\nwith\ttabs", "image"],
  });
  for (const path of ["a.o", "nested/a.obj", "out/code.c", "nested/out/code.c", "results/benchmarks/cells.tsv"]) assert.equal(buildOutput(path), true);
  assert.equal(buildOutput("compiler/outcome.rs"), false);
});
