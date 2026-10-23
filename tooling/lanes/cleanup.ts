// Default: inspect and log a dry run. Production execution requires the exact
// SHA256 of the approved JSON, plus the coordinator's approval outside this tool.
// node tooling/lanes/cleanup.ts --report inventory.json [--execute SHA256]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { processesInTree } from "./processes.ts";
import { buildOutput, inputFor, inspectWorktree, parseWorktrees, toolOwnedTrees, type inventory } from "./branches.ts";

type Report = Awaited<ReturnType<typeof inventory>>;
type Tree = Report["worktrees"][number];
type Branch = Report["branches"][number];
type Kind = "branch" | "worktree";
type State = "kept" | "planned" | "done" | "skipped";
export type Event = { at: string; mode: string; phase: string; operation: string; item: string; status: string; argv?: string[]; reason?: string; [key: string]: unknown };
export type CleanupOptions = { reportPath: string; executeDigest?: string; repo?: string; logPath?: string; home?: string; onEvent?: (event: Event) => void; procRoot?: string; readCwd?: (path: string) => string };
type Item = { kind: Kind; item: string; action: string; state: State; reason?: string };
type Saved = { ref: string; commit: string | null; indexHash: string | null; workHash: string };
const retires = new Set(["remove worktree", "snapshot then remove", "prune stale registration"]);
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function sha(bytes: string | Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function canonical(path: string): string { try { return realpathSync(path); } catch { return resolve(path); } }
function within(root: string, path: string): boolean { const r = relative(resolve(root), resolve(path)); return r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r); }
function safeName(path: string): string { return basename(path).replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/\.\./g, "-").replace(/^\.+|\.+$/g, "").replace(/\.lock$/, "-lock") || "tree"; }

class Cleaner {
  options: CleanupOptions; report: Report; digest: string; repo: string; common: string; home: string; execute: boolean;
  log: string; phase = "check"; items = new Map<string, Item>(); blocked = new Map<string, string>();
  saved = new Map<string, Saved>(); preserved = new Map<string, string>(); detached = new Set<string>();
  headArchives = new Map<string, string>();
  owned: ReturnType<typeof toolOwnedTrees>; operations = 0;
  constructor(options: CleanupOptions) {
    this.options = options;
    const bytes = readFileSync(options.reportPath); this.digest = sha(bytes); this.report = JSON.parse(bytes.toString());
    this.execute = options.executeDigest !== undefined;
    if (this.execute && (!/^[a-f0-9]{64}$/.test(options.executeDigest!) || options.executeDigest !== this.digest)) throw new Error("Report JSON digest mismatch; execution refused");
    this.repo = canonical(options.repo ?? this.report.repo); this.home = options.home ?? homedir();
    this.common = this.read(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
    if (!Array.isArray(this.report.branches) || !Array.isArray(this.report.worktrees) || !oid.test(this.report.main)) throw new Error("Invalid inventory JSON");
    for (const b of this.report.branches) {
      if (!oid.test(b.sha) || b.ref !== `refs/heads/${b.name}` || !["keep", "delete branch", "archive then delete", "NEEDS A PERSON"].includes(b.proposal.action)) throw new Error("Invalid branch row");
    }
    for (const w of this.report.worktrees) {
      if (!oid.test(w.sha) || !isAbsolute(w.path) || !["keep", ...retires, "NEEDS A PERSON"].includes(w.proposal.action)) throw new Error("Invalid worktree row");
    }
    const stamp = new Date().toISOString().replaceAll(":", "-");
    this.log = resolve(options.logPath ?? join(this.home, ".cache/nts-scratch/branch-inventory", `cleanup-${stamp}-${this.digest.slice(0, 12)}-${this.execute ? "execute" : "dry-run"}.jsonl`));
    for (const w of this.report.worktrees.filter(w => retires.has(w.proposal.action))) if (within(w.path, this.log)) throw new Error("Audit log must be outside retiring trees");
    mkdirSync(dirname(this.log), { recursive: true }); writeFileSync(this.log, "", { flag: "wx" });
    this.owned = toolOwnedTrees(this.repo, this.home);
    const shared = dirname(this.common);
    if (canonical(shared) !== this.repo) this.owned.push(...toolOwnedTrees(shared, this.home));
    this.emit("report", options.reportPath, "info", { digest: this.digest, main: this.report.main });
  }
  emit(operation: string, item: string, status: string, detail: Record<string, unknown> = {}): void {
    const event: Event = { at: new Date().toISOString(), mode: this.execute ? "execute" : "dry-run", phase: this.phase, operation, item, status, ...detail };
    appendFileSync(this.log, JSON.stringify(event) + "\n"); this.operations++;
    this.options.onEvent?.(event);
    console.log(`${event.mode} ${status} ${operation} ${item}${event.reason ? `: ${event.reason}` : ""}${event.argv ? ` ${JSON.stringify(event.argv)}` : ""}`);
  }
  git(args: string[], options: { cwd?: string; index?: string; input?: string | Buffer; write?: boolean } = {}) {
    if (options.write && !this.execute) throw new Error("Internal error: mutation attempted during dry-run");
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[key];
    if (options.index) env.GIT_INDEX_FILE = options.index;
    const r = spawnSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-C", options.cwd ?? this.repo, ...args], { env, input: options.input, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.error?.message ?? r.stderr ?? "" };
  }
  read(args: string[], options: { cwd?: string; index?: string; input?: string | Buffer; write?: boolean } = {}): string {
    const r = this.git(args, options); if (r.status) throw new Error(`${args[0]}: ${r.stderr.trim()}`); return r.stdout;
  }
  ref(ref: string): string | null { const r = this.git(["rev-parse", "--verify", "--quiet", ref]); return r.status ? null : r.stdout.trim(); }
  ancestry(a: string, b: string): boolean { return this.git(["merge-base", "--is-ancestor", a, b]).status === 0; }
  item(kind: Kind, item: string, action: string, state: State, reason?: string): void {
    this.items.set(`${kind}:${item}`, { kind, item, action, state, ...(reason ? { reason } : {}) });
    this.emit(action, item, state, { reason });
  }
  treeList(): Tree[] { return parseWorktrees(this.read(["worktree", "list", "--porcelain", "-z"])); }
  admin(path: string): { dir: string; headRef: string; index: string } {
    const matches: string[] = [];
    for (const name of readdirSync(join(this.common, "worktrees"))) {
      const dir = join(this.common, "worktrees", name);
      try { if (resolve(dirname(readFileSync(join(dir, "gitdir"), "utf8").trim())) === resolve(path)) matches.push(dir); } catch {}
    }
    if (matches.length !== 1) throw new Error("Worktree administrative registration is missing or ambiguous");
    const dir = matches[0]; return { dir, headRef: `worktrees/${basename(dir)}/HEAD`, index: join(dir, "index") };
  }
  processes(path: string): string[] {
    return processesInTree(path, { procRoot: this.options.procRoot, readCwd: this.options.readCwd,
      onExemption: detail => this.emit("process-cwd-exemption", path, "info", detail) });
  }
  statusKey(w: Tree): string {
    return JSON.stringify({ tracked: w.snapshotFiles.tracked.map(e => [e.status, e.path, e.from ?? ""]).sort(), untracked: [...w.snapshotFiles.untracked].sort() });
  }
  paths(w: Tree): string[] {
    const paths = new Set([...w.snapshotFiles.tracked.flatMap(e => [e.path, ...(e.from ? [e.from] : [])]), ...w.snapshotFiles.untracked]);
    return [...paths].filter(p => !buildOutput(p) && !inputFor(w.path, p)).map(p => {
      if (isAbsolute(p) || !within(w.path, join(w.path, p)) || p.split("/").includes(".git")) throw new Error(`Unsafe snapshot path ${p}`);
      return p;
    }).sort();
  }
  indexHash(w: Tree): string | null { const index = this.admin(w.path).index; return existsSync(index) ? sha(readFileSync(index)) : null; }
  workHash(w: Tree): string {
    const h = createHash("sha256");
    for (const p of this.paths(w)) {
      const path = join(w.path, p); h.update(p + "\0");
      let stat;
      try { stat = lstatSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") { h.update("deleted\0"); continue; } throw e; }
      if (stat.isSymbolicLink()) h.update("link\0" + readlinkSync(path));
      else if (stat.isFile()) { h.update(`file:${stat.mode & 0o111}:${stat.size}\0`); h.update(readFileSync(path)); }
      else throw new Error(`Unsupported snapshot file type: ${p}`);
      h.update("\0");
    }
    return h.digest("hex");
  }
  preflight(w: Tree): string | null {
    try {
      if (!this.ancestry(this.report.main, "refs/heads/main")) return "main history no longer retains the report base";
      const trees = this.treeList(), current = trees.find(t => resolve(t.path) === resolve(w.path));
      if (!current) return "registration disappeared";
      if (current.sha !== w.sha) return `HEAD moved: ${current.sha}`;
      if (current.branch !== w.branch && !(this.detached.has(w.path) && current.branch === null)) return "checkout branch changed";
      if (current.locked) return `worktree is locked: ${current.locked}`;
      if (canonical(w.path) !== resolve(w.path)) return "worktree path resolves elsewhere";
      const nested = trees.find(t => t.path !== w.path && within(w.path, t.path));
      if (nested) return `contains another registered tree: ${nested.path}`;
      for (const other of trees.filter(t => t.path !== w.path)) {
        const target = join(other.path, "target");
        if (existsSync(target) && within(w.path, canonical(target))) return `supplies target storage to ${other.path}`;
      }
      inspectWorktree(current, new Map(), dirname(this.common), this.home, this.owned, new Map(), new Map(), this.detached.has(w.path));
      if (current.protected) return current.protection!;
      if (current.errors.length) return current.errors.join("; ");
      const active = this.processes(w.path);
      if (active.length) return `process cwd inside tree: PID ${active.join(",")}`;
      const admin = this.admin(w.path);
      if (existsSync(join(admin.dir, "index.lock")) || existsSync(join(admin.dir, "HEAD.lock"))) return "Git metadata is locked";
      if (w.proposal.action === "prune stale registration") {
        if (!current.missing) return "directory reappeared";
        if (existsSync(admin.index)) {
          const staged = this.git(["diff-index", "--cached", "--quiet", w.sha, "--"], { index: admin.index });
          if (staged.status) return "stale registration retains staged work or an unreadable index";
        }
        return null;
      }
      if (current.missing) return "directory disappeared; refresh the inventory before pruning";
      const actualCommon = this.read(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: w.path }).trim();
      if (canonical(actualCommon) !== canonical(this.common)) return "directory now belongs to another repository";
      if (this.statusKey(current) !== this.statusKey(w)) return "work status changed since report";
      if (current.lastModifiedAt && Date.now() - Date.parse(current.lastModifiedAt) <= 86400000) return "in use: modified within 24 hours";
      if (w.proposal.action === "snapshot then remove") {
        for (const field of this.read(["ls-files", "--stage", "-z"], { cwd: w.path }).split("\0").filter(Boolean)) {
          const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]*)$/.exec(field)!;
          if (match[3] !== "0") return "unmerged index requires a separate snapshot";
          if (match[1] === "160000" && !inputFor(w.path, match[4]) && current.snapshotFiles.tracked.some(t => t.path === match[4])) return `non-input submodule work requires a separate snapshot: ${match[4]}`;
        }
        this.workHash(w); // Reject embedded repositories/non-regular paths.
      }
      return null;
    } catch (e) { return String(e); }
  }
  checkTree(w: Tree): boolean {
    const reason = this.blocked.get(w.path) ?? this.preflight(w);
    if (!reason) return true;
    this.blocked.set(w.path, reason); this.item("worktree", w.path, w.proposal.action, "skipped", reason); return false;
  }
  dependencies(b: Branch): Tree[] {
    const paths = new Set([...b.checkedOut, ...this.treeList().filter(w => w.branch === b.name).map(w => w.path)]);
    return [...paths].map(path => {
      const w = this.report.worktrees.find(w => w.path === path);
      if (!w || !retires.has(w.proposal.action)) throw new Error(`new or retained checkout: ${path}`);
      return w;
    });
  }
  branchReady(b: Branch): boolean {
    let reason = this.blocked.get(b.ref);
    if (!reason && !this.ancestry(this.report.main, "refs/heads/main")) reason = "main history no longer retains the report base";
    if (!reason && b.name === "main") reason = "protected main branch";
    if (!reason && b.state === "ACTIVE") {
      const date = Number(this.read(["show", "-s", "--format=%ct", b.sha]).trim());
      if (Date.now() / 1000 - date <= 3 * 86400) reason = "young active-lane branch";
    }
    if (!reason && this.ref(b.ref) !== b.sha) reason = "ref moved or disappeared since report";
    if (!reason && this.git(["symbolic-ref", "--quiet", b.ref]).status === 0) reason = "symbolic branch ref requires manual review";
    if (!reason) {
      try {
        for (const w of this.dependencies(b)) if (!this.checkTree(w)) { reason = `checkout failed recheck: ${w.path}`; break; }
      } catch (e) { reason = String(e); }
    }
    if (!reason) return true;
    this.blocked.set(b.ref, reason); this.item("branch", b.ref, b.proposal.action, "skipped", reason); return false;
  }
  createArchive(ref: string, value: string, item: string): boolean {
    if (!ref.startsWith("refs/archive/") || this.git(["check-ref-format", ref]).status) throw new Error(`Invalid archive destination: ${ref}`);
    const current = this.ref(ref);
    if (current !== null) {
      if (current === value && this.git(["symbolic-ref", "--quiet", ref]).status !== 0) {
        this.preserved.set(ref, value); this.emit("archive-ref", item, "info", { ref, sha: value, reason: "already preserved at the exact SHA" }); return true;
      }
      this.emit("archive-ref", item, "skipped", { ref, reason: "archive destination already exists at another value" }); return false;
    }
    const argv = ["update-ref", "--no-deref", ref, value, ""];
    this.emit("archive-ref", item, this.execute ? "attempt" : "planned", { argv });
    if (this.execute) {
      const r = this.git(argv, { write: true });
      if (r.status || this.ref(ref) !== value || !this.ancestry(value, ref)) { this.emit("archive-ref", item, "skipped", { reason: r.stderr.trim() || "archive verification failed" }); return false; }
      this.emit("archive-ref", item, "done", { ref, sha: value });
    }
    this.preserved.set(ref, value); return true;
  }
  retained(value: string): boolean {
    if (this.ancestry(value, "refs/heads/main")) return true;
    for (const [ref, preserved] of this.preserved) if ((!this.execute || this.ref(ref) === preserved) && this.ancestry(value, preserved)) return true;
    for (const b of this.report.branches) {
      // The approved LANDED classifier proves all patches are on report.main.
      if (["ANCESTOR", "LANDED"].includes(b.stateOfLanding) && this.ancestry(value, b.sha)) return true;
    }
    const refs = this.read(["for-each-ref", `--contains=${value}`, "--format=%(refname)", "refs/heads/", "refs/archive/"]).trim().split("\n").filter(Boolean);
    return refs.some(ref => ref.startsWith("refs/archive/") || !this.report.branches.some(b => b.ref === ref && ["delete branch", "archive then delete"].includes(b.proposal.action) && !this.blocked.has(ref)));
  }
  plumbing(args: string[], w: Tree, index: string, input?: string): string {
    this.emit("snapshot-plumbing", w.path, "attempt", { argv: args, temporaryIndex: index });
    const value = this.read(args, { cwd: w.path, index, input, write: true }).trim();
    this.emit("snapshot-plumbing", w.path, "done", { argv: args, ...(oid.test(value) ? { sha: value } : {}) });
    return value;
  }
  snapshot(w: Tree): void {
    if (!this.checkTree(w)) return;
    const ref = w.proposal.archiveRef;
    if (!ref || this.ref(ref) !== null) { this.blocked.set(w.path, "snapshot archive destination is missing or already exists"); this.checkTree(w); return; }
    try {
      const paths = this.paths(w), workHash = this.workHash(w), indexHash = this.indexHash(w);
      if (!paths.length) throw new Error("No approved snapshot paths remain");
      if (!this.execute) {
        this.emit("snapshot-build", w.path, "planned", { ref, parent: w.sha, paths, reason: "temporary index; staged state preserved as an intermediate parent if different" });
        this.emit("archive-ref", w.path, "planned", { argv: ["update-ref", "--no-deref", ref, "<snapshot-commit>", ""] });
        this.emit("verify-snapshot-reachability", w.path, "planned", { ref });
        this.saved.set(w.path, { ref, commit: null, indexHash, workHash });
        this.preserved.set(ref, w.sha); return;
      }
      const temp = mkdtempSync(join(dirname(this.log), ".cleanup-index-")), index = join(temp, "index");
      try {
        this.plumbing(["read-tree", w.sha], w, index);
        const staged = this.read(["ls-files", "--stage", "-z", "--", ...paths.map(p => `:(literal)${p}`)], { cwd: w.path });
        const entries = new Map(staged.split("\0").filter(Boolean).map(field => {
          const row = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]*)$/.exec(field);
          if (!row || row[3] !== "0") throw new Error("Unmerged or unreadable index");
          return [row[4], `${row[1]} ${row[2]}\t${row[4]}\0`];
        }));
        const zero = "0".repeat(w.sha.length);
        this.plumbing(["update-index", "-z", "--index-info"], w, index, paths.map(p => entries.get(p) ?? `0 ${zero}\t${p}\0`).join(""));
        const stagedTree = this.plumbing(["write-tree"], w, index);
        const headTree = this.read(["rev-parse", `${w.sha}^{tree}`]).trim();
        let parent = w.sha;
        if (stagedTree !== headTree) parent = this.plumbing(["commit-tree", stagedTree, "-p", w.sha], w, index,
          `archive: staged state of ${w.path}\n\nInventory SHA256: ${this.digest}\n`);
        this.plumbing(["add", "--all", "--", ...paths.map(p => `:(literal)${p}`)], w, index);
        const tree = this.plumbing(["write-tree"], w, index);
        const commit = this.plumbing(["commit-tree", tree, "-p", parent], w, index,
          `archive: working state of ${w.path}\n\nInventory SHA256: ${this.digest}\nOriginal HEAD: ${w.sha}\nOwn index SHA256: ${indexHash}\n`);
        if (!this.checkTree(w)) return;
        if (this.indexHash(w) !== indexHash || this.workHash(w) !== workHash) throw new Error("Work or index changed while snapshot was built");
        if (!this.createArchive(ref, commit, w.path)) throw new Error("Snapshot archive CAS failed");
        if (!this.ancestry(w.sha, ref) || !this.ancestry(commit, ref) || (parent !== w.sha && !this.ancestry(parent, ref))) throw new Error("Snapshot history is not reachable from archive");
        this.saved.set(w.path, { ref, commit, indexHash, workHash });
        this.emit("verify-snapshot-reachability", w.path, "done", { ref, commit, stagedParent: parent });
      } finally { rmSync(temp, { recursive: true, force: true }); }
    } catch (e) { this.blocked.set(w.path, String(e)); this.checkTree(w); }
  }
  archiveHeads(w: Tree): void {
    if (!this.checkTree(w)) return;
    let ref = w.proposal.archiveRef;
    if (!ref && !this.retained(w.sha)) ref = `refs/archive/${w.lane}/worktree/${safeName(w.path)}-${w.sha.slice(0, 12)}`;
    if (!ref) return;
    if (!this.createArchive(ref, w.sha, w.path)) { this.blocked.set(w.path, "HEAD archive CAS failed"); this.checkTree(w); }
    else this.headArchives.set(w.path, ref);
  }
  deleteBranch(b: Branch): void {
    if (!this.branchReady(b)) return;
    if (b.proposal.action === "archive then delete") {
      const ref = b.proposal.archiveRef!;
      if (this.preserved.get(ref) !== b.sha || (this.execute && (this.ref(ref) !== b.sha || !this.ancestry(b.sha, ref)))) {
        this.blocked.set(b.ref, "Required archive is not verified at the reported SHA"); this.branchReady(b); return;
      }
    }
    const deps = this.dependencies(b);
    const commands = ["start"];
    for (const w of deps) {
      commands.push("option no-deref", `update ${JSON.stringify(this.admin(w.path).headRef)} ${w.sha} ${w.sha}`);
    }
    commands.push("option no-deref", `delete ${JSON.stringify(b.ref)} ${b.sha}`, "prepare", "commit", "");
    const argv = deps.length ? ["update-ref", "--stdin"] : ["update-ref", "--no-deref", "-d", b.ref, b.sha];
    this.emit(deps.length ? "detach-heads-and-delete-ref" : "delete-ref", b.ref, this.execute ? "attempt" : "planned", { argv, ...(deps.length ? { transaction: commands, trees: deps.map(w => w.path) } : {}) });
    for (const w of deps) if (!this.checkTree(w)) {
      this.blocked.set(b.ref, `checkout failed final recheck: ${w.path}`); this.branchReady(b); return;
    }
    if (b.proposal.action === "archive then delete" && this.execute && this.ref(b.proposal.archiveRef!) !== b.sha) {
      this.blocked.set(b.ref, "Required archive moved immediately before deletion"); this.branchReady(b); return;
    }
    if (this.execute) {
      const r = this.git(argv, { write: true, ...(deps.length ? { input: commands.join("\n") } : {}) });
      if (r.status) {
        const reason = `Ref CAS rejected: ${r.stderr.trim()}`;
        this.blocked.set(b.ref, reason);
        for (const w of deps) this.blocked.set(w.path, reason);
        this.branchReady(b); return;
      }
      for (const w of deps) this.detached.add(w.path);
    }
    this.item("branch", b.ref, b.proposal.action, this.execute ? "done" : "planned");
  }
  removeTree(w: Tree): void {
    if (!this.checkTree(w)) return;
    const saved = this.saved.get(w.path);
    let reason: string | null = null;
    const headArchive = this.headArchives.get(w.path);
    if (headArchive && this.execute && this.ref(headArchive) !== w.sha) reason = "HEAD archive moved since creation";
    if (w.proposal.action === "snapshot then remove") {
      if (!saved) reason = "No verified snapshot";
      else if (this.indexHash(w) !== saved.indexHash || this.workHash(w) !== saved.workHash) reason = "Work or index changed after snapshot";
      else if (this.execute && (!saved.commit || this.ref(saved.ref) !== saved.commit || !this.ancestry(saved.commit, saved.ref))) reason = "Snapshot archive moved or is not reachable";
    } else if (!this.retained(w.sha)) reason = "HEAD is not retained outside this worktree";
    if (reason) { this.blocked.set(w.path, reason); this.checkTree(w); return; }
    const argv = ["worktree", "remove", "--force", w.path];
    this.emit(w.proposal.action === "prune stale registration" ? "prune-registration" : "remove-tree", w.path, this.execute ? "attempt" : "planned", { argv, reason: w.proposal.action === "prune stale registration" ? "targeted missing registration only; branch refs are separate" : undefined });
    // The observer/logger runs before this final guard too. It must not make
    // a newly dirty tree eligible merely because planning already succeeded.
    if (!this.checkTree(w)) return;
    if (saved && (this.indexHash(w) !== saved.indexHash || this.workHash(w) !== saved.workHash)) {
      this.blocked.set(w.path, "Work changed immediately before removal"); this.checkTree(w); return;
    }
    if (this.execute && ((saved && (!saved.commit || this.ref(saved.ref) !== saved.commit || !this.ancestry(saved.commit, saved.ref))) || (headArchive && this.ref(headArchive) !== w.sha))) {
      this.blocked.set(w.path, "Archive moved immediately before removal"); this.checkTree(w); return;
    }
    if (this.execute) {
      const r = this.git(argv, { write: true });
      if (r.status) { this.blocked.set(w.path, `Removal refused: ${r.stderr.trim()}`); this.checkTree(w); return; }
    }
    this.item("worktree", w.path, w.proposal.action, this.execute ? "done" : "planned");
  }
  diagnostics(label: string) {
    const objects = this.read(["count-objects", "-vH"]);
    const disk = spawnSync("df", ["-h", "/"], { encoding: "utf8" });
    const worktrees = this.read(["worktree", "list"]);
    const result = { objects, disk: disk.stdout, worktreeCount: worktrees.split("\n").filter(Boolean).length };
    this.emit("diagnostics", label, "info", result); return result;
  }
  run() {
    if (!this.ancestry(this.report.main, "refs/heads/main")) throw new Error("main no longer descends from report.main; refresh inventory");
    const before = this.diagnostics("before");
    for (const b of this.report.branches) if (b.proposal.action === "keep") this.item("branch", b.ref, b.proposal.action, "kept");
    for (const w of this.report.worktrees) if (w.proposal.action === "keep") this.item("worktree", w.path, w.proposal.action, "kept");
    for (const b of this.report.branches.filter(b => b.proposal.action === "NEEDS A PERSON")) this.item("branch", b.ref, b.proposal.action, "skipped", b.proposal.reason);
    for (const w of this.report.worktrees.filter(w => w.proposal.action === "NEEDS A PERSON")) this.item("worktree", w.path, w.proposal.action, "skipped", w.proposal.reason);
    this.phase = "archive";
    for (const b of this.report.branches.filter(b => b.proposal.action === "archive then delete")) {
      if (this.branchReady(b) && !this.createArchive(b.proposal.archiveRef!, b.sha, b.ref)) { this.blocked.set(b.ref, "Archive creation failed"); this.branchReady(b); }
    }
    for (const w of this.report.worktrees.filter(w => w.proposal.action === "snapshot then remove")) this.snapshot(w);
    for (const w of this.report.worktrees.filter(w => ["remove worktree", "prune stale registration"].includes(w.proposal.action))) this.archiveHeads(w);
    this.phase = "branches";
    for (const b of this.report.branches.filter(b => ["delete branch", "archive then delete"].includes(b.proposal.action))) this.deleteBranch(b);
    this.phase = "trees";
    for (const w of this.report.worktrees.filter(w => ["remove worktree", "snapshot then remove"].includes(w.proposal.action)).sort((a, b) => b.path.length - a.path.length)) this.removeTree(w);
    this.phase = "prune";
    for (const w of this.report.worktrees.filter(w => w.proposal.action === "prune stale registration")) this.removeTree(w);
    const after = this.diagnostics("after"), outcomes = [...this.items.values()];
    const summary = [...new Set(outcomes.map(i => i.action))].sort().map(action => ({ action,
      branches: Object.fromEntries(["kept", "planned", "done", "skipped"].map(state => [state, outcomes.filter(i => i.action === action && i.kind === "branch" && i.state === state).length])),
      worktrees: Object.fromEntries(["kept", "planned", "done", "skipped"].map(state => [state, outcomes.filter(i => i.action === action && i.kind === "worktree" && i.state === state).length])),
    }));
    const result = { mode: this.execute ? "execute" : "dry-run", digest: this.digest, report: resolve(this.options.reportPath), log: this.log, operations: this.operations, summary, skipped: outcomes.filter(i => i.state === "skipped"), before, after };
    writeFileSync(this.log + ".summary.json", JSON.stringify(result, null, 2) + "\n");
    return result;
  }
}

export function cleanup(options: CleanupOptions) { return new Cleaner(options).run(); }
function main(): void {
  const options: CleanupOptions = { reportPath: join(homedir(), ".cache/nts-scratch/branch-inventory/inventory.json") };
  let dry = false;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--dry-run") dry = true;
    else if (["--report", "--repo", "--log", "--execute"].includes(arg) && process.argv[i + 1]) {
      const value = process.argv[++i];
      if (arg === "--report") options.reportPath = value;
      if (arg === "--repo") options.repo = value;
      if (arg === "--log") options.logPath = value;
      if (arg === "--execute") options.executeDigest = value;
    } else if (arg === "--help") { console.log("node tooling/lanes/cleanup.ts --report JSON [--dry-run | --execute SHA256] [--log FILE] [--repo PATH]"); return; }
    else throw new Error(`Unknown/incomplete argument: ${arg}`);
  }
  if (dry && options.executeDigest !== undefined) throw new Error("Choose dry-run or execute, not both");
  console.log(JSON.stringify(cleanup(options), null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); } catch (e) { console.error(e); process.exitCode = 1; }
}
