import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { retireLanding, type RetirementEvent } from "./retire.ts";
import { toolOwnedTrees } from "./branches.ts";
import { fileURLToPath } from "node:url";

function fixture(homeTree = false) {
  const parent = join(homedir(), ".cache/nts-scratch/branch-inventory"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "retire-test-")), repo = join(root, "repo"), home = join(root, "home"), procRoot = join(root, "proc");
  mkdirSync(repo); mkdirSync(procRoot);
  const git = (args: string[], cwd = repo, input?: string) => { const r = spawnSync("git", ["-C", cwd, ...args], { input, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git(["init", "-q", "-b", "main"]); git(["config", "user.name", "test"]); git(["config", "user.email", "test@example.invalid"]);
  writeFileSync(join(repo, "base"), "base\n"); git(["add", "."]); git(["commit", "-qm", "base"]);
  const tree = homeTree ? join(home, "Projects/nts-lanes/compiler") : join(home, ".cache/nts-scratch/compiler/submission"); mkdirSync(dirname(tree), { recursive: true });
  const branch = "compiler/topic"; git(["worktree", "add", "-qb", branch, tree]);
  writeFileSync(join(tree, "change"), "land me\n"); git(["add", "change"], tree); git(["commit", "-qm", "land me"], tree);
  const sha = git(["rev-parse", "HEAD"], tree), index = git(["rev-parse", "--path-format=absolute", "--git-path", "index"], tree), indexBytes = readFileSync(index);
  writeFileSync(join(repo, "advance"), "main moved\n"); git(["add", "advance"]); git(["commit", "-qm", "advance"]); git(["cherry-pick", sha]);
  return { root, repo, home, procRoot, tree, branch, sha, git, index, indexBytes };
}

test("a clean replayed scratch landing removes its tree before CAS deletion, without detaching HEAD", async () => {
  const f = fixture();
  try {
    let checked = false;
    const r = await retireLanding(f.repo, f, { home: f.home, procRoot: f.procRoot, onEvent(e: RetirementEvent) {
      if (e.operation === "remove-submission-tree" && e.status === "attempt") {
        assert.equal(f.git(["symbolic-ref", "--short", "HEAD"], f.tree), f.branch);
        assert.deepEqual(readFileSync(f.index), f.indexBytes); checked = true;
      }
    } });
    assert.ok(checked); assert.equal(r.tree, "removed"); assert.equal(r.branch, "deleted");
    assert.equal(existsSync(f.tree), false); assert.equal(f.git(["for-each-ref", "refs/heads/compiler/topic"]), "");
    const remove = r.events.findIndex(e => e.operation === "remove-submission-tree" && e.status === "done");
    assert.ok(r.events.findIndex(e => e.operation === "delete-landed-topic" && e.status === "done") > remove);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("lane homes keep their branch attached; another checkout also prevents deletion", async () => {
  for (const homeTree of [true, false]) {
    const f = fixture(homeTree);
    try {
      const other = join(f.root, "other");
      if (!homeTree) f.git(["worktree", "add", "-q", "--force", other, f.branch]);
      const r = await retireLanding(f.repo, f, { home: f.home, procRoot: f.procRoot });
      assert.equal(r.tree, homeTree ? "kept" : "removed"); assert.equal(r.branch, "kept");
      assert.equal(f.git(["symbolic-ref", "--short", "HEAD"], homeTree ? f.tree : other), f.branch);
      assert.ok(r.events.some(e => e.status === "still checked out"));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test("dirty, busy and moved submission trees are kept", async () => {
  for (const kind of ["dirty", "busy", "moved"]) {
    const f = fixture();
    try {
      if (kind === "dirty") writeFileSync(join(f.tree, "new-work"), "keep this\n");
      if (kind === "busy") { mkdirSync(join(f.procRoot, "123")); symlinkSync(f.tree, join(f.procRoot, "123/cwd")); }
      if (kind === "moved") { writeFileSync(join(f.tree, "next"), "next commit\n"); f.git(["add", "next"], f.tree); f.git(["commit", "-qm", "next"], f.tree); }
      const r = await retireLanding(f.repo, f, { home: f.home, procRoot: f.procRoot });
      assert.equal(r.tree, "kept", kind); assert.equal(r.branch, "kept", kind); assert.ok(existsSync(f.tree));
      assert.equal(f.git(["symbolic-ref", "--short", "HEAD"], f.tree), f.branch);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test("final guards catch newly dirty trees, new checkouts and moved refs", async () => {
  for (const kind of ["dirty", "checkout", "ref"]) {
    const f = fixture();
    try {
      const newer = f.git(["commit-tree", `${f.sha}^{tree}`, "-p", f.sha], f.repo, "new unlanded commit\n");
      const r = await retireLanding(f.repo, f, { home: f.home, procRoot: f.procRoot, onEvent(e) {
        if (kind === "dirty" && e.operation === "remove-submission-tree" && e.status === "attempt") writeFileSync(join(f.tree, "new-work"), "keep\n");
        if (e.operation === "delete-landed-topic" && e.status === "attempt") {
          if (kind === "checkout") f.git(["worktree", "add", "-q", join(f.root, "new-checkout"), f.branch]);
          if (kind === "ref") f.git(["update-ref", `refs/heads/${f.branch}`, newer, f.sha]);
        }
      } });
      assert.equal(r.tree, kind === "dirty" ? "kept" : "removed"); assert.equal(r.branch, "kept");
      assert.equal(f.git(["rev-parse", f.branch]), kind === "ref" ? newer : f.sha);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test("tool-owned caches are retained and subject-only or unlanded history never qualifies", async () => {
  for (const kind of ["cache", "non-scratch", "PROBABLY-LANDED", "UNLANDED"]) {
    const f = fixture();
    try {
      let tree = f.tree;
      if (kind === "cache" || kind === "non-scratch") {
        tree = kind === "cache" ? toolOwnedTrees(join(dirname(fileURLToPath(import.meta.url)), "../.."), f.home, {})[0].path : join(f.root, "permanent-tree");
        mkdirSync(dirname(tree), { recursive: true }); f.git(["worktree", "move", f.tree, tree]);
      } else {
        const base = f.git(["rev-parse", `${f.sha}^`]);
        const rewritten = f.git(["commit-tree", `${base}^{tree}`, "-p", base], f.repo, (kind === "PROBABLY-LANDED" ? "land me" : "different subject") + "\n");
        f.git(["update-ref", "refs/heads/main", rewritten]);
      }
      const r = await retireLanding(f.repo, { ...f, tree }, { home: f.home, procRoot: f.procRoot });
      assert.equal(r.tree, "kept"); assert.equal(r.branch, "kept");
      assert.ok(existsSync(tree)); assert.equal(f.git(["symbolic-ref", "--short", "HEAD"], tree), f.branch);
      assert.ok(r.events.some(e => kind === "cache" ? e.reason === "tool-owned tree" : kind === "non-scratch" ? e.reason === "not a scratch submission tree" : e.reason?.includes(kind)));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});
