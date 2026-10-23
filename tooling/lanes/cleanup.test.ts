// node --test tooling/lanes/cleanup.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inventory } from "./branches.ts";
import { cleanup, type Event } from "./cleanup.ts";

function age(path: string, date: Date): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) { lutimesSync(path, date, date); return; }
  if (stat.isDirectory()) for (const name of readdirSync(path)) age(join(path, name), date);
  utimesSync(path, date, date);
}

async function fixture() {
  const parent = join(homedir(), ".cache/nts-scratch/branch-inventory");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "cleanup-test-")), repo = join(root, "repo");
  mkdirSync(repo);
  const procRoot = join(root, "proc"); mkdirSync(procRoot);
  const old = new Date(Date.now() - 5 * 86400000);
  const env = { ...process.env, GIT_AUTHOR_DATE: old.toISOString(), GIT_COMMITTER_DATE: old.toISOString() };
  const git = (args: string[], cwd = repo, input?: string) => {
    const result = spawnSync("git", ["-C", cwd, ...args], { env, input, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "cleanup-test"]); git(["config", "user.email", "test@example.invalid"]);
  for (const dir of ["lanes", "gate", "census", "conformance"]) mkdirSync(join(repo, "tooling", dir), { recursive: true });
  writeFileSync(join(repo, "tooling/lanes/lanes.json"), JSON.stringify({ lanes: { compiler: { branch: "compiler/" }, jvm: { branch: "jvm/" }, tsrs: { branch: "tsrs/" } } }));
  writeFileSync(join(repo, "tooling/lanes/land.ts"), 'const HOME = process.env.NTS_LAND_HOME ?? homedir();\nconst MAINCTL = join(HOME, ".cache/test-land");\nconst GATE_TREE = join(MAINCTL, "tree");\n');
  writeFileSync(join(repo, "tooling/gate/pinned.sh"), 'tree=${NTS_GATE_TREE:-$HOME/.cache/test-gate/tree}\n');
  writeFileSync(join(repo, "tooling/census/full.ts"), 'const HOME = join(homedir(), ".cache/test-full");\nconst env = {\n NTS_GATE_TREE: join(HOME, "tree"),\n};\n');
  writeFileSync(join(repo, "tooling/conformance/pin.ts"), 'export const PINS = process.env.NTS_PINS ?? join(homedir(), ".cache/test-pins");\nconst TREE = join(PINS, "tree");\n');
  writeFileSync(join(repo, ".gitignore"), "target/\n");
  writeFileSync(join(repo, "source.ts"), "original\n");
  git(["add", "."]); git(["commit", "-qm", "base"]);
  const head = git(["rev-parse", "HEAD"]);
  const tree = (name: string, branch = `compiler/${name}`) => {
    const path = join(root, name);
    git(branch ? ["worktree", "add", "-q", "-b", branch, path, head] : ["worktree", "add", "-q", "--detach", path, head]);
    return path;
  };
  const report = async () => {
    age(root, old);
    const data = await inventory({ repo, home: root, protectedTree: repo });
    const path = join(root, "inventory.json"), bytes = JSON.stringify(data, null, 2) + "\n";
    writeFileSync(path, bytes);
    return { data, path, digest: createHash("sha256").update(bytes).digest("hex") };
  };
  return { root, repo, git, head, tree, report, procRoot };
}

test("dry-run defaults to reads, and a mismatched report digest cannot execute", async () => {
  const f = await fixture();
  try {
    const path = f.tree("dirty");
    writeFileSync(join(path, "source.ts"), "working\n");
    writeFileSync(join(path, "new.ts"), "untracked\n");
    const report = await f.report();
    const refs = f.git(["show-ref"]), trees = f.git(["worktree", "list", "--porcelain"]), objects = f.git(["count-objects", "-v"]);
    const index = f.git(["rev-parse", "--path-format=absolute", "--git-path", "index"], path), bytes = readFileSync(index), mtime = statSync(index).mtimeMs;
    const result = cleanup({ reportPath: report.path, repo: f.repo, home: f.root, procRoot: f.procRoot, logPath: join(f.root, "dry.jsonl") });
    assert.equal(result.mode, "dry-run");
    assert.equal(result.skipped.length, 0);
    assert.ok(result.summary.some(r => r.action === "snapshot then remove" && r.worktrees.planned === 1));
    assert.equal(f.git(["show-ref"]), refs); assert.equal(f.git(["worktree", "list", "--porcelain"]), trees);
    assert.equal(f.git(["count-objects", "-v"]), objects);
    assert.deepEqual(readFileSync(index), bytes); assert.equal(statSync(index).mtimeMs, mtime);
    assert.equal(readFileSync(join(path, "source.ts"), "utf8"), "working\n");
    assert.throws(() => cleanup({ reportPath: report.path, executeDigest: "0".repeat(64), repo: f.repo }), /digest mismatch/);
    assert.equal(f.git(["show-ref"]), refs);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("CAS skips a moved ref and rechecks a tree made dirty after the report", async () => {
  const f = await fixture();
  try {
    f.git(["branch", "compiler/moved"]);
    const dirty = f.tree("newly-dirty"), atRemoval = f.tree("dirty-at-removal");
    const report = await f.report();
    writeFileSync(join(dirty, "new.ts"), "new work after inventory\n");
    const moved = f.git(["commit-tree", `${f.head}^{tree}`, "-p", f.head], f.repo, "unlanded replacement\n");
    let changedRef = false, changedTree = false;
    const result = cleanup({ reportPath: report.path, executeDigest: report.digest, repo: f.repo, home: f.root, procRoot: f.procRoot, logPath: join(f.root, "execute.jsonl"), onEvent(e: Event) {
      if (e.operation === "delete-ref" && e.item === "refs/heads/compiler/moved" && e.status === "attempt") {
        f.git(["update-ref", e.item, moved, f.head]); changedRef = true;
      }
      if (e.operation === "remove-tree" && e.item === atRemoval && e.status === "attempt") {
        writeFileSync(join(atRemoval, "new.ts"), "new work immediately before removal\n"); changedTree = true;
      }
    } });
    assert.ok(changedRef && changedTree);
    assert.equal(f.git(["rev-parse", "refs/heads/compiler/moved"]), moved);
    assert.ok(result.skipped.some(i => i.item === "refs/heads/compiler/moved" && /CAS rejected/.test(i.reason!)));
    assert.ok(result.skipped.some(i => i.item === dirty && /work status changed/.test(i.reason!)));
    assert.ok(result.skipped.some(i => i.item === atRemoval && /work status changed/.test(i.reason!)));
    assert.equal(f.git(["rev-parse", "refs/heads/compiler/newly-dirty"]), f.head);
    assert.ok(existsSync(join(dirty, "new.ts"))); assert.ok(existsSync(join(atRemoval, "new.ts")));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("snapshots retain staged and working versions without writing the tree's index; clean and stale removals stay targeted", async () => {
  const f = await fixture();
  try {
    const dirty = f.tree("snapshot"), clean = f.tree("clean"), detached = f.tree("detached", ""), gone = f.tree("gone");
    const shared = join(f.root, "same-branch");
    f.git(["worktree", "add", "-q", "--force", shared, "compiler/clean"]);
    writeFileSync(join(dirty, "source.ts"), "staged version\n"); f.git(["add", "source.ts"], dirty);
    writeFileSync(join(dirty, "source.ts"), "working version\n");
    writeFileSync(join(dirty, "new.ts"), "untracked source\n");
    writeFileSync(join(dirty, "artifact.o"), "excluded build product\n");
    rmSync(gone, { recursive: true });
    const report = await f.report();
    const row = report.data.worktrees.find(w => w.path === dirty)!;
    assert.equal(row.proposal.action, "snapshot then remove");
    const index = f.git(["rev-parse", "--path-format=absolute", "--git-path", "index"], dirty), bytes = readFileSync(index), mtime = statSync(index).mtimeMs;
    let verifiedIndex = false;
    const result = cleanup({ reportPath: report.path, executeDigest: report.digest, repo: f.repo, home: f.root, procRoot: f.procRoot, logPath: join(f.root, "execute.jsonl"), onEvent(e: Event) {
      if (e.operation === "remove-tree" && e.item === dirty && e.status === "attempt") {
        assert.deepEqual(readFileSync(index), bytes); assert.equal(statSync(index).mtimeMs, mtime); verifiedIndex = true;
        f.git(["merge-base", "--is-ancestor", f.head, row.proposal.archiveRef!]);
      }
    } });
    assert.deepEqual(result.skipped, []);
    assert.ok(verifiedIndex);
    const ref = row.proposal.archiveRef!;
    assert.equal(f.git(["show", `${ref}:source.ts`]), "working version");
    assert.equal(f.git(["show", `${ref}^:source.ts`]), "staged version");
    assert.equal(f.git(["show", `${ref}:new.ts`]), "untracked source");
    assert.equal(f.git(["ls-tree", "--name-only", ref, "artifact.o"]), "");
    for (const path of [dirty, clean, shared, detached, gone]) assert.equal(existsSync(path), false);
    assert.equal(f.git(["worktree", "list", "--porcelain"]).split("worktree ").length - 1, 1);
    assert.equal(f.git(["for-each-ref", "--format=%(refname)", "refs/heads/"]), "refs/heads/main");
    const log = readFileSync(result.log, "utf8").trim().split("\n").map(s => JSON.parse(s) as Event);
    assert.ok(log.some(e => e.operation === "detach-heads-and-delete-ref" && (e.trees as string[]).length === 2));
    const firstDeletion = log.findIndex(e => e.phase === "branches");
    assert.ok(log.filter(e => e.operation === "archive-ref" && e.status === "done").every(e => log.indexOf(e) < firstDeletion));
    assert.equal(log.findLast(e => e.operation === "prune-registration")!.phase, "prune");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("only exact SSH daemon names exempt EACCES; unreadable node and readable active cwd block removal", async () => {
  const f = await fixture();
  try {
    const path = f.tree("idle");
    const pid = join(f.procRoot, "123"); mkdirSync(pid);
    const report = await f.report();
    const denied = () => { const error = new Error("Permission denied") as NodeJS.ErrnoException; error.code = "EACCES"; throw error; };
    for (const comm of ["sshd-session", "sshd"]) {
      writeFileSync(join(pid, "comm"), comm + "\n");
      const result = cleanup({ reportPath: report.path, repo: f.repo, home: f.root, procRoot: f.procRoot, readCwd: denied, logPath: join(f.root, `${comm}.jsonl`) });
      assert.deepEqual(result.skipped, []);
      const log = readFileSync(result.log, "utf8");
      assert.ok(log.includes('"operation":"process-cwd-exemption"'));
      assert.ok(log.includes(`"comm":"${comm}"`)); assert.ok(log.includes('"pid":"123"'));
    }
    for (const comm of ["node", "sshd-session-extra", "sshd "]) {
      writeFileSync(join(pid, "comm"), comm + "\n");
      const result = cleanup({ reportPath: report.path, repo: f.repo, home: f.root, procRoot: f.procRoot, readCwd: denied, logPath: join(f.root, `${comm}-denied.jsonl`) });
      assert.ok(result.skipped.some(i => i.item === path && /Cannot inspect own-user PID 123/.test(i.reason!)));
    }
    writeFileSync(join(pid, "comm"), "systemd\n");
    const command = "/usr/lib/systemd/systemd\0--user\0";
    writeFileSync(join(pid, "cmdline"), command);
    const manager = cleanup({ reportPath: report.path, repo: f.repo, home: f.root, procRoot: f.procRoot, readCwd: denied, logPath: join(f.root, "user-manager.jsonl") });
    assert.deepEqual(manager.skipped, []);
    assert.ok(readFileSync(manager.log, "utf8").includes('"comm":"systemd"'));
    for (const [n, cmdline] of ["/usr/lib/systemd/systemd\0--system\0", "/wrong/systemd\0--user\0", command + "--extra\0"].entries()) {
      writeFileSync(join(pid, "cmdline"), cmdline);
      const result = cleanup({ reportPath: report.path, repo: f.repo, home: f.root, procRoot: f.procRoot, readCwd: denied, logPath: join(f.root, `wrong-manager-${n}.jsonl`) });
      assert.ok(result.skipped.some(i => i.item === path && /Cannot inspect own-user PID 123/.test(i.reason!)));
    }
    symlinkSync(path, join(pid, "cwd"));
    const result = cleanup({ reportPath: report.path, repo: f.repo, home: f.root, procRoot: f.procRoot, logPath: join(f.root, "active.jsonl") });
    assert.ok(result.skipped.some(i => i.item === path && /process cwd inside tree: PID 123/.test(i.reason!)));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("the exact PAM helper requires an independently verified user-manager parent", async () => {
  const f = await fixture();
  try {
    const path = f.tree("idle"), child = join(f.procRoot, "123"), parent = join(f.procRoot, "999");
    mkdirSync(child); mkdirSync(parent);
    writeFileSync(join(child, "comm"), "(sd-pam)\n"); writeFileSync(join(child, "cmdline"), "(sd-pam)\0");
    writeFileSync(join(child, "status"), "PPid:\t999\n");
    writeFileSync(join(parent, "comm"), "systemd\n"); writeFileSync(join(parent, "cmdline"), "/usr/lib/systemd/systemd\0--user\0");
    const report = await f.report();
    const denied = () => { const error = new Error("Permission denied") as NodeJS.ErrnoException; error.code = "EACCES"; throw error; };
    const run = (name: string) => cleanup({ reportPath: report.path, repo: f.repo, home: f.root, procRoot: f.procRoot, readCwd: denied, logPath: join(f.root, `${name}.jsonl`) });
    const allowed = run("valid-parent"); assert.deepEqual(allowed.skipped, []);
    const events = readFileSync(allowed.log, "utf8").split("\n").filter(Boolean).map(s => JSON.parse(s) as Event);
    assert.ok(events.some(e => e.operation === "process-cwd-exemption" && e.pid === "123" && e.parent === "999"));
    writeFileSync(join(child, "status"), "PPid:\t998\n");
    assert.ok(run("wrong-parent").skipped.some(i => i.item === path && /Cannot inspect own-user PID 123/.test(i.reason!)));
    writeFileSync(join(child, "status"), "PPid:\t999\n"); writeFileSync(join(parent, "cmdline"), "/usr/lib/systemd/systemd\0--system\0");
    assert.ok(run("wrong-parent-command").skipped.some(i => i.item === path && /Cannot inspect own-user PID 123/.test(i.reason!)));
    writeFileSync(join(parent, "cmdline"), "/usr/lib/systemd/systemd\0--user\0"); writeFileSync(join(child, "cmdline"), "(sd-pam)\0--extra\0");
    assert.ok(run("wrong-child-command").skipped.some(i => i.item === path && /Cannot inspect own-user PID 123/.test(i.reason!)));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
