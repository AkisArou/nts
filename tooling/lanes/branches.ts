// Read-only inventory; proposals here never execute cleanup.
// node tooling/lanes/branches.ts [--repo PATH] [--out PATH]
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type LaneState = "ACTIVE" | "PAUSED" | "CLOSED" | "INACTIVE" | "UNKNOWN";
type Landed = "ANCESTOR" | "LANDED" | "PROBABLY-LANDED" | "UNLANDED" | "UNKNOWN";
type Action = { action: string; reason: string; archiveRef?: string };
type Diffstat = { files: number; insertions: number; deletions: number; binaryFiles: number };
type Commit = { sha: string; parents: string[]; timestamp: number; date: string; subject: string; diffstat?: Diffstat };
type Ref = { ref: string; sha: string };
type Lane = { lane: string; state: LaneState; source: string };
type Branch = Ref & Lane & {
  name: string; date: string; ageDays: number; checkedOut: string[]; effectiveCheckouts: string[]; retiringCheckouts: string[]; stateOfLanding: Landed;
  mergeBase: string | null; unmatched: Commit[]; unmatchedDiffstat: Diffstat | null; errors: string[]; proposal: Action;
};
type Worktree = {
  path: string; sha: string; branch: string | null; detached: boolean; prunable: string | null;
  locked: string | null; active: string[]; protected: boolean; protection: string | null; missing: boolean; lane: string; dirty: boolean | null;
  tracked: { status: string; path: string; from?: string }[]; untracked: string[];
  inputs: { status: string; path: string; reason: string; link?: string; target?: string }[];
  missingInputs: { status: string; path: string }[];
  buildOutputs: { status: string; path: string }[];
  snapshotFiles: { tracked: Worktree["tracked"]; untracked: string[] };
  rootModifiedAt: string | null; lastModifiedAt: string | null; recentlyUsed: boolean;
  target: { path: string; realPath: string | null; bytes: number | null; sharedWith: string[] };
  errors: string[]; notes: string[]; proposal: Action;
};

// MainClaude's user-authorized lane states, 2026-10-23T20:06:40.040Z.
// Orcode 1c85129a-75a0-46a7-9b9f-ce8f8a834ba3. sdk/ and claude/ are
// explicit historical prefixes, not entries invented in lanes.json.
export const LANE_STATES: Record<string, { state: LaneState; since: string }> = {
  compiler: { state: "ACTIVE", since: "2026-10-23" }, tsrs: { state: "ACTIVE", since: "2026-10-23" },
  jvm: { state: "PAUSED", since: "2026-10-22" }, wasm: { state: "PAUSED", since: "2026-10-22" },
  react: { state: "CLOSED", since: "2026-10-15" }, chromium: { state: "CLOSED", since: "2026-10-15" },
  gtk: { state: "CLOSED", since: "2026-10-15" }, node: { state: "CLOSED", since: "2026-10-15" },
  apple: { state: "INACTIVE", since: "mid-October 2026" }, windows: { state: "INACTIVE", since: "mid-October 2026" },
  sdk: { state: "INACTIVE", since: "mid-October 2026" }, claude: { state: "INACTIVE", since: "mid-October 2026" },
};
const STATE_SOURCE = "MainClaude / user, Orcode 1c85129a-75a0-46a7-9b9f-ce8f8a834ba3, 2026-10-23T20:06:40.040Z";
const CLEANUP_SOURCE = "MainClaude, compiler lane owner, Orcode 3c2f6032-2f9b-40c4-8a69-d99bca708127, 2026-10-23T20:28:30.278Z";
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
const gitOptions = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];
const readCommands = new Set(["rev-parse", "for-each-ref", "log", "merge-base", "worktree", "status", "ls-files", "patch-id"]);
function git(repo: string, args: string[], input?: string): string {
  if (!readCommands.has(args[0]) || (args[0] === "worktree" && args[1] !== "list")) throw new Error("Non-read-only Git command");
  const r = spawnSync("git", [...gitOptions, "-C", repo, ...args], { env, input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${args[0]}: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout;
}
function refs(repo: string, prefix: string): Ref[] {
  return git(repo, ["for-each-ref", "--format=%(refname)%00%(objectname)", prefix]).trimEnd().split("\n")
    .filter(Boolean).map(row => { const [ref, sha] = row.split("\0"); return { ref, sha }; });
}

// Read the tools' path expressions, never import/execute their CLI bodies.
// This deliberately small grammar fails closed if a tool changes its syntax.
function pathExpression(source: string, expression: string, home: string, variables: NodeJS.ProcessEnv): string {
  const definitions = new Map([...source.matchAll(/^\s*(?:export\s+)?const\s+(\w+)\s*=\s*([^;]+);/gm)].map(m => [m[1], m[2].trim()]));
  const resolving = new Set<string>();
  function evaluate(expression: string): string | undefined {
    let p = 0;
    const space = () => { while (/\s/.test(expression[p] ?? "") && p < expression.length) p++; };
    function primary(): string | undefined {
      space();
      const rest = expression.slice(p);
      const literal = /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/.exec(rest);
      if (literal) {
        p += literal[0].length;
        if (literal[0][0] === '"') return JSON.parse(literal[0]);
        const body = literal[0].slice(1, -1);
        if (body.includes("\\")) throw new Error("Unsupported escaped single-quoted path literal");
        return body;
      }
      const variable = /^process\.env\.([A-Z_0-9]+)/.exec(rest);
      if (variable) { p += variable[0].length; return variables[variable[1]]; }
      const name = /^(\w+)/.exec(rest)?.[1];
      if (!name) throw new Error(`Unsupported path expression near ${rest}`);
      p += name.length; space();
      if (expression[p] === "(") {
        p++; space();
        if (name === "homedir" && expression[p] === ")") { p++; return home; }
        if (name !== "join" && name !== "resolve") throw new Error(`Unsupported path function: ${name}`);
        const args: string[] = [];
        while (expression[p] !== ")") {
          const value = expr();
          if (value === undefined) throw new Error("Undefined path argument");
          args.push(value); space();
          if (expression[p] !== ",") break;
          p++; space();
        }
        if (expression[p++] !== ")") throw new Error("Unclosed path expression");
        return name === "join" ? join(...args) : resolve(...args);
      }
      const value = definitions.get(name);
      if (value === undefined || resolving.has(name)) throw new Error(`Unknown/cyclic path constant: ${name}`);
      resolving.add(name);
      try { return evaluate(value); } finally { resolving.delete(name); }
    }
    function expr(): string | undefined {
      let value = primary(); space();
      while (expression.slice(p, p + 2) === "??") {
        p += 2; const fallback = primary(); value ??= fallback; space();
      }
      return value;
    }
    const value = expr(); space();
    if (p !== expression.length) throw new Error(`Unsupported path expression suffix: ${expression.slice(p)}`);
    return value;
  }
  const value = evaluate(expression);
  if (!value) throw new Error(`Empty tool path: ${expression}`);
  return value;
}

export function toolOwnedTrees(repo: string, home = homedir(), variables: NodeJS.ProcessEnv = process.env) {
  const result: { tool: string; expression: string; path: string }[] = [];
  const add = (tool: string, expression: string, path: string) => {
    const resolved = resolve(repo, path);
    if (!result.some(r => r.tool === tool && r.path === resolved)) result.push({ tool, expression, path: resolved });
  };
  for (const configured of [false, true]) {
    const vars = configured ? variables : {};
    for (const [tool, expression] of [["tooling/lanes/land.ts", "GATE_TREE"], ["tooling/conformance/pin.ts", "TREE"]]) {
      const source = readFileSync(join(repo, tool), "utf8");
      add(tool, expression, pathExpression(source, expression, home, vars));
    }
    const full = "tooling/census/full.ts", source = readFileSync(join(repo, full), "utf8");
    const expression = /^\s*NTS_GATE_TREE:\s*(.+),\s*$/m.exec(source)?.[1];
    if (!expression) throw new Error(`Cannot derive tool-owned tree from ${full}`);
    add(full, `NTS_GATE_TREE: ${expression}`, pathExpression(source, expression, home, vars));
    const pinned = "tooling/gate/pinned.sh", shell = readFileSync(join(repo, pinned), "utf8");
    const setting = /^tree=["']?\$\{([A-Z_0-9]+):-([^\n]+)\}["']?\s*$/m.exec(shell);
    if (!setting) throw new Error(`Cannot derive tool-owned tree from ${pinned}`);
    const fallback = setting[2].replace(/\$\{HOME\}|\$HOME\b/g, home);
    if (/[$`]/.test(fallback)) throw new Error(`Unsupported shell path expression in ${pinned}`);
    add(pinned, setting[0], vars[setting[1]] || fallback);
  }
  return result;
}

function owner(name: string, lanes: Record<string, { branch: string }>): Lane {
  const match = Object.entries(lanes).sort((a, b) => b[1].branch.length - a[1].branch.length).find(([, x]) => name.startsWith(x.branch));
  const compilerAlias = ["archive/compiler-helper/", "bench/", "exp/", "keep/", "docs/", "runtime/"].some(p => name.startsWith(p)) || name.startsWith("worktree-agent-");
  const lane = match?.[0] ?? (compilerAlias ? "compiler" : undefined) ?? (["sdk", "claude"].find(x => name.startsWith(`${x}/`))) ?? "unknown";
  return { lane, state: LANE_STATES[lane]?.state ?? "UNKNOWN", source: match ? "lanes.json prefix" : compilerAlias ? "compiler owner's dated prefix mapping" : lane !== "unknown" ? "dated historical prefix" : "unrecognized prefix" };
}
function reachable(start: string | string[], graph: Map<string, Commit>): Set<string> {
  const found = new Set<string>(), stack = typeof start === "string" ? [start] : [...start];
  while (stack.length) {
    const sha = stack.pop()!;
    if (found.has(sha)) continue;
    found.add(sha);
    const c = graph.get(sha);
    if (!c) throw new Error(`Missing commit metadata: ${sha}`);
    stack.push(...c.parents);
  }
  return found;
}

export function parseDiffstats(raw: string): Map<string, { stat: Diffstat; paths: string[] }> {
  const result = new Map<string, { stat: Diffstat; paths: string[] }>();
  let current: { stat: Diffstat; paths: string[] } | undefined;
  for (const field of raw.split("\0")) {
    if (/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(field.trim())) {
      current = { stat: { files: 0, insertions: 0, deletions: 0, binaryFiles: 0 }, paths: [] };
      result.set(field.trim(), current);
    } else if (field && current) {
      const row = /^\n?(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(field);
      if (!row) throw new Error(`Invalid numstat record: ${JSON.stringify(field)}`);
      current.paths.push(row[3]); current.stat.files++;
      if (row[1] === "-" || row[2] === "-") current.stat.binaryFiles++;
      else { current.stat.insertions += Number(row[1]); current.stat.deletions += Number(row[2]); }
    }
  }
  return result;
}

// Stream patches rather than buffering the repository's entire history.
// The main history enters this pipeline exactly once per inventory.
async function patchIds(repo: string, revisions: string[], stdin = false): Promise<Map<string, string>> {
  const args = [...gitOptions, "-C", repo, "log", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color",
    "--format=commit %H", "-p", "--binary", "--root", "--diff-merges=off", ...(stdin ? ["--no-walk=unsorted", "--stdin"] : revisions)];
  const source = spawn("git", args, { env, stdio: ["pipe", "pipe", "pipe"] });
  const sink = spawn("git", [...gitOptions, "-C", repo, "patch-id", "--stable"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const errors: string[] = [];
  source.stderr.on("data", b => errors.push(String(b)));
  sink.stderr.on("data", b => errors.push(String(b)));
  let output = "";
  sink.stdout.on("data", b => { output += b; });
  source.stdout.pipe(sink.stdin);
  // An early child failure must be reported, rather than an unhandled EPIPE.
  source.stdin.on("error", e => errors.push(String(e)));
  sink.stdin.on("error", e => errors.push(String(e)));
  const done = (child: ReturnType<typeof spawn>) => new Promise<number | null>((ok, fail) => { child.on("error", fail); child.on("close", ok); });
  const completed = Promise.all([done(source), done(sink)]);
  source.stdin.end(stdin ? revisions.join("\n") + "\n" : undefined);
  const codes = await completed;
  if (codes.some(code => code !== 0) || errors.length) throw new Error(`patch-id failed (${codes}): ${errors.join("")}`);
  return new Map(output.trim().split("\n").filter(Boolean).map(row => { const [id, sha] = row.split(/\s+/); return [sha, id]; }));
}

export function parseWorktrees(raw: string): Worktree[] {
  const trees: Worktree[] = [];
  let w: Worktree | undefined;
  for (const field of raw.split("\0")) {
    if (field.startsWith("worktree ")) {
      w = { path: field.slice(9), sha: "", branch: null, detached: false, prunable: null, locked: null,
        active: [], protected: false, protection: null, missing: false, lane: "unknown", dirty: null, tracked: [], untracked: [],
        inputs: [], missingInputs: [], buildOutputs: [], snapshotFiles: { tracked: [], untracked: [] }, rootModifiedAt: null, lastModifiedAt: null, recentlyUsed: false,
        target: { path: join(field.slice(9), "target"), realPath: null, bytes: null, sharedWith: [] }, errors: [], notes: [],
        proposal: { action: "NEEDS A PERSON", reason: "Not inspected" } };
      trees.push(w);
    } else if (w) {
      if (field.startsWith("HEAD ")) w.sha = field.slice(5);
      else if (field.startsWith("branch ")) w.branch = field.slice(7).replace(/^refs\/heads\//, "");
      else if (field === "detached") w.detached = true;
      else if (field === "prunable" || field.startsWith("prunable ")) w.prunable = field.slice(9) || "unspecified";
      else if (field === "locked" || field.startsWith("locked ")) w.locked = field.slice(7) || "unspecified";
    }
  }
  return trees;
}
export function parseStatus(raw: string): { tracked: Worktree["tracked"]; untracked: string[] } {
  const fields = raw.split("\0"), tracked: Worktree["tracked"] = [], untracked: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const row = fields[i];
    if (!row) continue;
    if (row.startsWith("?? ")) untracked.push(row.slice(3));
    else if (!row.startsWith("!! ")) {
      const entry: Worktree["tracked"][number] = { status: row.slice(0, 2), path: row.slice(3) };
      if (/[RC]/.test(entry.status)) entry.from = fields[++i];
      tracked.push(entry);
    }
  }
  return { tracked, untracked };
}
function canonical(path: string): string { try { return realpathSync(path); } catch { return resolve(path); } }
function defaultActive(home: string, trees: Worktree[]): Map<string, string[]> {
  const active = new Map<string, string[]>();
  const add = (path: string, why: string) => { const p = canonical(path); active.set(p, [...(active.get(p) ?? []), why]); };
  for (const lane of ["compiler", "compiler-helper", "tsrs-native", "tsrs", "tsrs-frontend71", "tsrs-query"])
    add(join(home, "Projects/nts-lanes", lane), "User's active tree list, 2026-10-23");
  const state = join(home, ".cache/nts-land");
  try {
    for (const file of readdirSync(join(state, "queue"))) {
      const q = JSON.parse(readFileSync(join(state, "queue", file), "utf8"));
      if (typeof q.tree === "string") add(q.tree, "Pending landing queue source");
    }
  } catch { /* No queue is normal outside the coordinator's machine. */ }
  // A landing's queue entry disappears when the train takes it, but its
  // caller may still be alive in the source tree. Keep all trees with live
  // processes inside them, including these landing sources and probe trees.
  try {
    for (const pid of readdirSync("/proc").filter(p => /^\d+$/.test(p))) {
      try {
        const cwd = canonical(readlinkSync(`/proc/${pid}/cwd`));
        const tree = trees.filter(w => within(canonical(w.path), cwd)).sort((a, b) => b.path.length - a.path.length)[0];
        if (tree) add(tree.path, `Live PID ${pid} (${readFileSync(`/proc/${pid}/comm`, "utf8").trim()}) working inside tree`);
      } catch { /* Processes can exit, or belong to another user. */ }
    }
  } catch { /* /proc is unavailable off Linux; explicit list/queue still apply. */ }
  return active;
}

function within(root: string, path: string): boolean {
  const r = relative(resolve(root), resolve(path));
  return r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
}
function laneHome(path: string, home: string): boolean {
  const r = relative(join(home, "Projects/nts-lanes"), resolve(path));
  return !!r && r !== ".." && !isAbsolute(r) && !r.includes(sep);
}
export function inputFor(tree: string, path: string): { reason: string; link?: string; target?: string } | null {
  if (path === "third_party/typescript-go") return { reason: "Patched TypeScript-Go input gitlink" };
  const root = canonical(tree);
  let cursor = resolve(tree);
  for (const part of path.split("/")) {
    cursor = join(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        const target = canonical(resolve(dirname(cursor), readlinkSync(cursor)));
        if (!within(root, target)) return { reason: "Symlinked input outside this worktree", link: relative(tree, cursor), target };
      }
    } catch (e) {
      if (["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? "")) break;
      throw e;
    }
  }
  return null;
}
export function buildOutput(path: string): boolean {
  return /\.(o|obj)$/.test(path) || /(^|\/)out(\/|$)/.test(path) || path === "target" || path.startsWith("target/") || path.startsWith("results/benchmarks/");
}
export function missingInput(status: string, path: string): boolean {
  return path.startsWith("third_party/") && (status === " D" || status === "D ");
}
function pathLane(path: string): string {
  for (const part of resolve(path).split(sep).reverse()) {
    if (LANE_STATES[part]) return part;
    if (part === "compiler-helper") return "compiler";
    if (part.startsWith("tsrs-")) return "tsrs";
  }
  return "unknown";
}
function archiveBasename(path: string): string {
  return basename(path).replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/\.\./g, "-").replace(/^\.+|\.+$/g, "").replace(/\.lock$/, "-lock") || "tree";
}
const retiringActions = new Set(["remove worktree", "snapshot then remove", "prune stale registration"]);
function retires(w: Worktree): boolean { return retiringActions.has(w.proposal.action); }

function inspectWorktree(w: Worktree, active: Map<string, string[]>, protectedTree: string, home: string, owned: ReturnType<typeof toolOwnedTrees>, sizeCache: Map<string, number>): void {
  w.active = active.get(canonical(w.path)) ?? [];
  const owners = owned.filter(t => canonical(t.path) === canonical(w.path));
  w.protection = owners.length ? "tool-owned tree" : canonical(w.path) === canonical(protectedTree) ? "Shared landing checkout" : laneHome(w.path, home) ? "Lane home / resume point" : null;
  if (owners.length) w.notes.push(...owners.map(t => `Owned by ${t.tool}, path expression ${t.expression}.`));
  w.protected = !!w.protection;
  let latest = 0;
  const noteTime = (path: string) => {
    try { latest = Math.max(latest, lstatSync(path).mtimeMs); }
    catch (e) { w.errors.push(`mtime ${path}: ${String(e)}`); }
  };
  try {
    let rootStat;
    try { rootStat = statSync(w.path); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") { w.missing = true; w.notes.push("Worktree directory is gone (ENOENT); branch refs are retained independently."); }
      throw e;
    }
    w.rootModifiedAt = rootStat.mtime.toISOString();
    noteTime(w.path);
    let complete = true, raw: string;
    try { raw = git(w.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]); }
    catch (e) {
      const failedPath = /expected submodule path '([\s\S]*)' not to be a symbolic link/.exec(String(e))?.[1];
      const input = failedPath ? inputFor(w.path, failedPath) : null;
      if (failedPath && input) {
        w.inputs.push({ status: "gitlink", path: failedPath, ...input });
        w.notes.push(`Read-only input fallback: ${String(e)}`);
      } else { w.errors.push(String(e)); complete = false; }
      raw = git(w.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all", "--", ".", ":(exclude)third_party/typescript-go"]);
    }
    const parsed = parseStatus(raw);
    for (const entry of parsed.tracked) {
      if (missingInput(entry.status, entry.path)) { w.missingInputs.push({ status: entry.status, path: entry.path }); continue; }
      const input = inputFor(w.path, entry.path);
      if (input && (!entry.from || inputFor(w.path, entry.from))) w.inputs.push({ status: entry.status, path: entry.path, ...input });
      else w.tracked.push(entry);
    }
    for (const path of parsed.untracked) {
      const input = inputFor(w.path, path);
      if (input) w.inputs.push({ status: "??", path, ...input }); else w.untracked.push(path);
    }
    w.snapshotFiles.tracked = w.tracked.filter(e => !buildOutput(e.path));
    w.snapshotFiles.untracked = w.untracked.filter(p => !buildOutput(p));
    w.buildOutputs = [...w.tracked.filter(e => buildOutput(e.path)), ...w.untracked.filter(buildOutput).map(path => ({ status: "??", path }))];
    const rootDirty = w.snapshotFiles.tracked.length > 0 || w.snapshotFiles.untracked.length > 0;
    w.dirty = rootDirty ? true : complete ? false : null;
    // Timestamp means the newest visible non-ignored file, root directory or
    // per-worktree Git HEAD/index. Ignored build products are excluded.
    const paths = new Set([...git(w.path, ["ls-files", "-z"]).split("\0").filter(Boolean), ...w.untracked]);
    for (const path of paths) if (!inputFor(w.path, path) && existsSync(join(w.path, path))) noteTime(join(w.path, path));
    for (const name of ["HEAD", "index"]) {
      const path = git(w.path, ["rev-parse", "--path-format=absolute", "--git-path", name]).trim();
      if (existsSync(path)) noteTime(path);
    }
  } catch (e) { if (!w.missing) w.errors.push(String(e)); }
  w.lastModifiedAt = latest ? new Date(latest).toISOString() : null;
  try {
    let targetExists = true;
    try { lstatSync(w.target.path); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") targetExists = false; else throw e; }
    if (!targetExists) w.target.bytes = 0;
    else {
      const path = realpathSync(w.target.path);
      w.target.realPath = path;
      if (!sizeCache.has(path)) {
        const r = spawnSync("du", ["-s", "-B1", "--", path], { encoding: "utf8" });
        if (r.error || r.status !== 0) throw new Error(`du: ${r.error?.message ?? r.stderr.trim()}`);
        const bytes = Number(/^\d+/.exec(r.stdout)?.[0]);
        if (!Number.isFinite(bytes)) throw new Error(`Invalid du output: ${r.stdout}`);
        sizeCache.set(path, bytes);
      }
      w.target.bytes = sizeCache.get(path)!;
    }
  } catch (e) { w.errors.push(`target: ${String(e)}`); }
}

export function branchProposal(b: Branch, trees: Worktree[], protectedRef = "main"): Action {
  if (b.name === protectedRef) return { action: "keep", reason: "Protected main branch" };
  if (b.state === "ACTIVE" && b.ageDays <= 3) return { action: "keep", reason: "Active lane's branch is at most three days old; checkout retirement cannot override this" };
  const checked = trees.filter(w => b.checkedOut.includes(w.path) && !retires(w));
  if (checked.some(w => w.proposal.action === "NEEDS A PERSON")) return { action: "NEEDS A PERSON", reason: "Checkout has an unresolved inspection or archive ambiguity" };
  if (checked.length) return { action: "keep", reason: "Checked out by a retained tree" };
  if (b.errors.length || b.stateOfLanding === "UNKNOWN") return { action: "NEEDS A PERSON", reason: b.errors.join("; ") || "Unknown landing state" };
  if (b.stateOfLanding === "ANCESTOR" || b.stateOfLanding === "LANDED") return { action: "delete branch", reason: "All commits retained on main; no checkout" };
  if (b.stateOfLanding === "PROBABLY-LANDED") return {
    action: "archive then delete", archiveRef: `refs/archive/${b.lane}/${b.name}`,
    reason: "Subject-only match may hide a changed body; retain the exact commits in an archive",
  };
  if (b.retiringCheckouts.length) return {
    action: "archive then delete", archiveRef: `refs/archive/${b.lane}/${b.name}`,
    reason: "Only checkouts are proposed for retirement; preserve unlanded commits before deleting the branch",
  };
  if (b.ageDays <= 3) return { action: "keep", reason: "Tip is at most three days old" };
  if (b.lane === "compiler") return {
    action: "archive then delete", archiveRef: `refs/archive/${b.lane}/${b.name}`,
    reason: "Compiler owner's decision: archive old unlanded unchecked-out branches, including evidence-only work",
  };
  if (b.state === "ACTIVE") return { action: "NEEDS A PERSON", reason: "Active lane's old unlanded branch; agent may still want it" };
  if (["PAUSED", "CLOSED", "INACTIVE"].includes(b.state)) return {
    action: "archive then delete", archiveRef: `refs/archive/${b.lane}/${b.name}`,
    reason: `${b.state} lane; unlanded tip older than three days; no checkout`,
  };
  return { action: "NEEDS A PERSON", reason: "Unknown owner lane or lane state" };
}

export type Options = { repo: string; now?: Date; home?: string; activeTrees?: string[]; protectedTree?: string };
export async function inventory(options: Options) {
  const { repo } = options, now = options.now ?? new Date(), home = options.home ?? homedir();
  const startedAt = new Date().toISOString(), warnings: string[] = [];
  const main = git(repo, ["rev-parse", "refs/heads/main"]).trim();
  const heads = refs(repo, "refs/heads/"), archives = refs(repo, "refs/archive/");
  const common = git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const laneFile = join(repo, "tooling/lanes/lanes.json");
  const lanes = JSON.parse(readFileSync(laneFile, "utf8")).lanes as Record<string, { branch: string }>;
  const trees = parseWorktrees(git(repo, ["worktree", "list", "--porcelain", "-z"]));
  const active = options.activeTrees ? new Map(options.activeTrees.map(p => [canonical(p), ["Explicit active tree"]])) : defaultActive(home, trees);
  const owned = toolOwnedTrees(repo, home);
  const sizeCache = new Map<string, number>();
  for (const w of trees) {
    w.lane = w.branch ? owner(w.branch, lanes).lane : pathLane(w.path);
    inspectWorktree(w, active, options.protectedTree ?? dirname(common), home, owned, sizeCache);
    w.recentlyUsed = w.lastModifiedAt !== null && now.getTime() - Date.parse(w.lastModifiedAt) <= 24 * 60 * 60 * 1000;
  }
  for (const w of trees) if (w.target.realPath) w.target.sharedWith = trees.filter(x => x.path !== w.path && x.target.realPath === w.target.realPath).map(x => x.path);

  const graph = new Map<string, Commit>();
  const fields = git(repo, ["log", "--all", ...trees.map(w => w.sha).filter(Boolean), "--format=%H%x00%P%x00%ct%x00%cI%x00%s", "-z"]).split("\0");
  for (let i = 0; i + 4 < fields.length; i += 5) {
    const [sha, parents, timestamp, date, subject] = fields.slice(i, i + 5);
    graph.set(sha, { sha, parents: parents ? parents.split(" ") : [], timestamp: Number(timestamp), date, subject });
  }
  const onMain = reachable(main, graph), mainIds = await patchIds(repo, [main]);
  const idsOnMain = new Map<string, string[]>();
  for (const [sha, id] of mainIds) idsOnMain.set(id, [...(idsOnMain.get(id) ?? []), sha]);
  const ranges = new Map<string, string[]>(), excluded = new Map<string, Set<string>>(), needed = new Set<string>();
  const branches: Branch[] = [];
  for (const r of heads) {
    const c = graph.get(r.sha)!;
    const b: Branch = { ...r, ...owner(r.ref.slice(11), lanes), name: r.ref.slice(11), date: c?.date ?? "unknown",
      ageDays: c ? (now.getTime() / 1000 - c.timestamp) / 86400 : 0,
      checkedOut: trees.filter(w => w.branch === r.ref.slice(11)).map(w => w.path),
      effectiveCheckouts: [], retiringCheckouts: [],
      stateOfLanding: "UNKNOWN", mergeBase: null, unmatched: [], unmatchedDiffstat: null, errors: [], proposal: { action: "NEEDS A PERSON", reason: "Not classified" } };
    branches.push(b);
    if (onMain.has(r.sha)) { b.stateOfLanding = "ANCESTOR"; continue; }
    try {
      const bases = git(repo, ["merge-base", "--all", main, r.sha]).trim().split("\n").filter(Boolean);
      if (bases.length !== 1) throw new Error(`Expected one merge-base, found ${bases.length}`);
      b.mergeBase = bases[0];
      if (!excluded.has(bases[0])) excluded.set(bases[0], reachable(bases[0], graph));
      if (!ranges.has(r.sha)) ranges.set(r.sha, [...reachable(r.sha, graph)].filter(sha => !excluded.get(bases[0])!.has(sha)));
      for (const sha of ranges.get(r.sha)!) if (!onMain.has(sha)) needed.add(sha);
    } catch (e) { b.errors.push(String(e)); }
  }
  const otherIds = needed.size ? await patchIds(repo, [...needed], true) : new Map<string, string>();
  const subjects = new Map<string, Set<string>>();
  for (const b of branches) {
    if (b.mergeBase && !b.errors.length) {
      const before = excluded.get(b.mergeBase)!;
      if (!subjects.has(b.mergeBase)) subjects.set(b.mergeBase, new Set([...onMain].filter(s => !before.has(s)).map(s => graph.get(s)!.subject)));
      const unmatched = ranges.get(b.sha)!.filter(sha => {
        // Identical commits need no patch comparison; empty and merge commits
        // without a patch ID remain unmatched unless identical on main.
        if (onMain.has(sha) && !before.has(sha)) return false;
        const id = otherIds.get(sha);
        return !id || !(idsOnMain.get(id) ?? []).some(s => !before.has(s));
      });
      b.unmatched = unmatched.map(s => graph.get(s)!);
      b.stateOfLanding = unmatched.length === 0 ? "LANDED" : b.unmatched.every(c => subjects.get(b.mergeBase!)!.has(c.subject)) ? "PROBABLY-LANDED" : "UNLANDED";
    }
  }
  const unmatchedShas = [...new Set(branches.flatMap(b => b.unmatched.map(c => c.sha)))];
  let stats = new Map<string, { stat: Diffstat; paths: string[] }>();
  try {
    if (unmatchedShas.length) stats = parseDiffstats(git(repo, ["log", "--no-walk=unsorted", "--stdin", "--format=%H", "--numstat", "-z", "--root", "--diff-merges=first-parent", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-color"], unmatchedShas.join("\n") + "\n"));
    for (const b of branches.filter(b => b.unmatched.length)) {
      const paths = new Set<string>(), total = { files: 0, insertions: 0, deletions: 0, binaryFiles: 0 };
      for (const c of b.unmatched) {
        const found = stats.get(c.sha);
        if (!found) throw new Error(`No diffstat for ${c.sha}`);
        c.diffstat = found.stat;
        found.paths.forEach(p => paths.add(p));
        total.insertions += found.stat.insertions; total.deletions += found.stat.deletions; total.binaryFiles += found.stat.binaryFiles;
      }
      total.files = paths.size; b.unmatchedDiffstat = total;
    }
  } catch (e) {
    for (const b of branches.filter(b => b.unmatched.length)) b.errors.push(`Unmatched diffstat incomplete: ${String(e)}`);
  }
  const archivedCommits = reachable(archives.map(a => a.sha), graph);
  for (const w of trees) {
    if (w.protected) w.proposal = { action: "keep", reason: w.protection! };
    else if (w.active.length) w.proposal = { action: "keep", reason: w.active.join("; ") };
    else if (w.recentlyUsed) w.proposal = { action: "keep", reason: "in use: lastModifiedAt is within 24 hours" };
    else if (w.locked) w.proposal = { action: "NEEDS A PERSON", reason: `Worktree is locked: ${w.locked}` };
    else if (w.missing) w.proposal = { action: "prune stale registration", reason: "Directory is gone; prune only the administrative registration, not branch refs" };
    else if (w.errors.length || w.dirty === null) w.proposal = { action: "NEEDS A PERSON", reason: "Inaccessible or incompletely inspected worktree" };
    else if (w.dirty) w.proposal = { action: "snapshot then remove", archiveRef: `refs/archive/${w.lane}/snapshot/${archiveBasename(w.path)}`,
      reason: "Preserve HEAD plus listed tracked/untracked work in a snapshot commit; exclude linked inputs and listed build outputs" };
    else {
      w.proposal = { action: "remove worktree", reason: "Clean inactive tree; preserve its HEAD via main, retained/archive refs or the associated branch action" };
      if (!onMain.has(w.sha) && !archivedCommits.has(w.sha) && !branches.some(b => b.sha === w.sha || ranges.get(b.sha)?.includes(w.sha))) {
        w.proposal.archiveRef = `refs/archive/${w.lane}/worktree/${archiveBasename(w.path)}-${w.sha.slice(0, 12)}`;
        w.proposal.reason = "Archive the detached HEAD at the stated ref before removing this clean inactive tree";
      }
    }
  }
  const destinations = new Map<string, Worktree[]>();
  for (const w of trees.filter(w => w.proposal.archiveRef)) {
    const ref = w.proposal.archiveRef!;
    destinations.set(ref, [...(destinations.get(ref) ?? []), w]);
  }
  for (const [ref, candidates] of destinations) {
    const existing = archives.find(a => a.ref === ref);
    if ((candidates.length > 1 && (candidates.some(w => w.dirty) || new Set(candidates.map(w => w.sha)).size > 1)) || (existing && (candidates[0].dirty || existing.sha !== candidates[0].sha))) {
      for (const w of candidates) {
        const unique = `${ref}-${createHash("sha256").update(resolve(w.path)).digest("hex").slice(0, 12)}`;
        w.notes.push(`Disambiguated colliding archive basename: ${ref} -> ${unique}.`);
        if (archives.some(a => a.ref === unique) || trees.some(x => x !== w && x.proposal.archiveRef === unique))
          w.proposal = { action: "NEEDS A PERSON", reason: `Disambiguated archive destination also exists: ${unique}` };
        else w.proposal.archiveRef = unique;
      }
    }
  }
  for (const b of branches) {
    b.retiringCheckouts = trees.filter(w => b.checkedOut.includes(w.path) && retires(w)).map(w => w.path);
    b.effectiveCheckouts = b.checkedOut.filter(p => !b.retiringCheckouts.includes(p));
    b.proposal = branchProposal(b, trees);
    if (b.proposal.archiveRef) {
      const previous = archives.find(a => a.ref === b.proposal.archiveRef);
      if (previous && previous.sha !== b.sha) b.proposal = { action: "NEEDS A PERSON", reason: "Proposed archive ref already points to a different commit" };
    }
    if (b.retiringCheckouts.length) for (const w of trees.filter(w => b.retiringCheckouts.includes(w.path)))
      w.notes.push(`Associated branch ${b.name}: ${b.proposal.action}${b.proposal.archiveRef ? ` (${b.proposal.archiveRef})` : ""}.`);
  }
  const archiveCounts: Record<string, number> = {};
  const archiveItems = archives.map(r => {
    const name = r.ref.slice("refs/archive/".length), lane = owner(name, lanes);
    // Legacy flat apple-foo / wasm-foo archive names are not prefix matches.
    // Keep their provenance unknown rather than quietly inventing ownership.
    archiveCounts[lane.lane] = (archiveCounts[lane.lane] ?? 0) + 1;
    return { ...r, ...lane, proposal: { action: "keep", reason: "Archive refs preserve history; no cleanup proposed" } };
  });
  const sameRefs = (a: Ref[], b: Ref[]) => JSON.stringify(a) === JSON.stringify(b);
  if (!sameRefs(heads, refs(repo, "refs/heads/")) || !sameRefs(archives, refs(repo, "refs/archive/"))) warnings.push("Refs changed during the inventory; rerun before any cleanup approval.");
  const endingTrees = parseWorktrees(git(repo, ["worktree", "list", "--porcelain", "-z"]));
  if (JSON.stringify(trees.map(w => [w.path, w.sha, w.branch])) !== JSON.stringify(endingTrees.map(w => [w.path, w.sha, w.branch]))) warnings.push("Worktree registrations/HEADs changed during the inventory; rerun before cleanup.");
  const count = (xs: string[]) => Object.fromEntries([...new Set(xs)].sort().map(k => [k, xs.filter(x => x === k).length]));
  const summary = [...new Set([...branches.map(b => b.proposal.action), ...trees.map(w => w.proposal.action)])].sort().map(action => ({
    action, branches: branches.filter(b => b.proposal.action === action).length,
    worktrees: trees.filter(w => w.proposal.action === action).length, targetFreedBytes: 0,
  }));
  for (const [path, bytes] of sizeCache) {
    const owners = trees.filter(w => w.target.realPath === path);
    const enclosing = trees.filter(w => retires(w) && within(canonical(w.path), path)).sort((a, b) => b.path.length - a.path.length)[0];
    if (enclosing && owners.every(retires)) summary.find(s => s.action === enclosing.proposal.action)!.targetFreedBytes += bytes;
  }
  const series = new Map<string, { branch: Branch; aliases: string[] }>();
  for (const b of branches.filter(b => b.stateOfLanding === "UNLANDED" && b.proposal.action === "archive then delete" && b.unmatchedDiffstat)
    .sort((a, b) => (b.unmatchedDiffstat!.insertions + b.unmatchedDiffstat!.deletions) - (a.unmatchedDiffstat!.insertions + a.unmatchedDiffstat!.deletions))) {
    const key = b.unmatched.map(c => otherIds.get(c.sha) ?? c.sha).sort().join(" ");
    if (series.has(key)) series.get(key)!.aliases.push(b.name); else series.set(key, { branch: b, aliases: [] });
  }
  const topUnlanded = [...series.values()].slice(0, 10);
  return {
    generatedAt: new Date().toISOString(), startedAt, policyDate: now.toISOString(), repo: canonical(repo), main,
    policy: { source: STATE_SOURCE, cleanupSource: CLEANUP_SOURCE, protectionSource: "MainClaude, Orcode ef53845d-c574-458c-bb14-66425b714ded, 2026-10-23T20:50:43.941Z", laneStates: LANE_STATES, activeTrees: Object.fromEntries(active), protectedTree: options.protectedTree ?? dirname(common), toolOwnedTrees: owned,
      protectedLaneHomes: join(home, "Projects/nts-lanes/*"),
      timestampDefinition: "Newest mtime of visible tracked/untracked non-ignored files, root directory and per-worktree Git HEAD/index; ignored build products excluded.",
      targetDefinition: "du -s -B1 allocated bytes; target symlink resolved, nested symlinks not followed; shared real paths counted once in total.",
      landingDefinition: "Stable patch IDs restricted to main commits after the unique merge-base; subject-only matches are archived before proposed branch deletion (MainClaude, Orcode 5f16afb4-4064-4d43-bf56-573216406c5e).",
      diffstatDefinition: "Unmatched commits: unique file paths across the series; summed added/deleted lines; binary-file changes counted separately. Merges diff against the first parent; renames count as delete/add.",
      inputDefinition: "Status paths under external symlinks, and the patched third_party/typescript-go gitlink, are INPUTS and do not count as work. Pure deletions under third_party/ are MISSING INPUTS, retained in HEAD (MainClaude, Orcode 5183622e-e243-43e9-ad34-c16ababacade). Other deletions and nonlinked additions/modifications remain work. Expected linked-submodule errors use the read-only pathspec fallback.",
      snapshotDefinition: "Snapshot tracked changes and non-ignored untracked work, excluding linked/missing inputs, *.o, *.obj, target/, out/ and results/benchmarks/*; preserve HEAD as the parent. Colliding snapshot basenames get a stable path-hash suffix, approved in Orcode 5183622e; no existing archive is overwritten.",
      targetFreedDefinition: "Estimated exclusive target allocation freed if all proposals are approved: real paths counted once, only inside retiring trees, and only when no retained worktree references the target. External/shared targets are excluded.",
      checkedOutRule: "Lane homes, tool-owned infrastructure, active processes and trees used within 24 hours are kept. An ACTIVE lane's branch at most three days old is kept regardless of checkout retirement. Other branches checked out only by retiring/pruned trees inherit retirement: landed branches delete, unlanded branches archive then delete. Old unchecked-out compiler branches archive by the compiler owner's decision; tsrs policy is unchanged." },
    totals: { branches: branches.length, landed: count(branches.map(b => b.stateOfLanding)), branchActions: count(branches.map(b => b.proposal.action)),
      worktrees: trees.length, dirtyWorktrees: trees.filter(w => w.dirty).length, inaccessibleOrIncompleteWorktrees: trees.filter(w => !w.missing && (w.errors.length || w.dirty === null)).length,
      missingWorktrees: trees.filter(w => w.missing).length, recentlyUsedWorktrees: trees.filter(w => w.recentlyUsed).length, toolOwnedWorktrees: trees.filter(w => w.protection === "tool-owned tree").length, worktreesWithInputs: trees.filter(w => w.inputs.length).length,
      worktreesWithMissingInputs: trees.filter(w => w.missingInputs.length).length,
      worktreeActions: count(trees.map(w => w.proposal.action)), archiveRefs: archives.length, archivesByLane: archiveCounts,
      uniqueTargetBytes: [...sizeCache.values()].reduce((a, b) => a + b, 0), uniqueTargetPaths: sizeCache.size,
      unknownTargetSizes: trees.filter(w => w.target.bytes === null).length,
      mainPatchIdPasses: 1, mainPatchIds: mainIds.size, otherPatchIdCommits: otherIds.size },
    summary, topUnlanded, reallyDirtyTrees: trees.filter(w => w.dirty).map(w => w.path),
    warnings, branches, worktrees: trees, archives: archiveItems,
  };
}

export function markdown(report: Awaited<ReturnType<typeof inventory>>): string {
  const cell = (s: unknown) => String(s ?? "—").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("|", "&#124;").replaceAll("\n", "<br>");
  const table = (headers: string[], rows: unknown[][]) => [headers.join(" | "), headers.map(() => "---").join(" | "), ...rows.map(r => r.map(cell).join(" | "))].join("\n");
  const gib = (bytes: number | null) => bytes === null ? "unknown" : `${(bytes / 2 ** 30).toFixed(3)} GiB`;
  const diffstat = (d: Diffstat | null | undefined) => d ? `${d.files} files; +${d.insertions}/-${d.deletions}${d.binaryFiles ? `; ${d.binaryFiles} binary changes` : ""}` : "—";
  const lines = ["# Branch and worktree inventory", "", `Snapshot ${report.startedAt} – ${report.generatedAt}; main ${report.main}.`, "",
    "Proposals only. No Git refs, indexes, worktrees or build outputs are changed by this tool. Approval and cleanup require a separate step.", "",
    "## Proposed actions", "", table(["Action", "Branches", "Worktrees", "GiB of target/ freed (estimate)"], report.summary.map(s => [s.action, s.branches, s.worktrees, (s.targetFreedBytes / 2 ** 30).toFixed(3)])), "",
    report.policy.targetFreedDefinition, "",
    "## Really dirty trees", "", report.reallyDirtyTrees.length ? table(["Path", "Tracked work files", "Untracked work files", "Proposed action", "Snapshot ref"], report.worktrees.filter(w => w.dirty).map(w => [w.path, w.snapshotFiles.tracked.length, w.snapshotFiles.untracked.length, w.proposal.action, w.proposal.archiveRef])) : "None.", "",
    "Full file lists, linked inputs and excluded build outputs appear in the worktree details below.", "",
    "## Ten largest unlanded series to triage", "", "Ranked by added plus deleted lines among proposed archive candidates. Patch-equivalent aliases are grouped; retained active work stays out of this cleanup shortlist.", "",
    table(["Branch", "Aliases", "Unmatched commits", "Files", "Lines added", "Lines deleted", "Proposed action"], report.topUnlanded.map(s => [s.branch.name, s.aliases.join("; "), s.branch.unmatched.length, s.branch.unmatchedDiffstat!.files, s.branch.unmatchedDiffstat!.insertions, s.branch.unmatchedDiffstat!.deletions, s.branch.proposal.action])), "",
    "## Totals", "", table(["Item", "Count"], Object.entries(report.totals).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v])), "",
    `Lane policy: ${report.policy.source}.`, "", table(["Lane / historical prefix", "State", "Since"], Object.entries(report.policy.laneStates).map(([k, v]) => [k, v.state, v.since])), "",
    `Cleanup policy: ${report.policy.cleanupSource}. Protected lane homes: ${report.policy.protectedLaneHomes}.`, "",
    `Infrastructure and recent-use protection: ${report.policy.protectionSource}.`, "",
    table(["Owning tool", "Path expression", "Protected tree"], report.policy.toolOwnedTrees.map(t => [t.tool, t.expression, t.path])), "",
    `Protected checkout: ${report.policy.protectedTree}. Active trees:`, "",
    table(["Path", "Reason"], Object.entries(report.policy.activeTrees).map(([p, why]) => [p, why.join("; ")])), "",
    report.policy.timestampDefinition, report.policy.targetDefinition, report.policy.landingDefinition, report.policy.diffstatDefinition, report.policy.inputDefinition, report.policy.snapshotDefinition, report.policy.checkedOutRule, "",
    ...(report.warnings.length ? ["## Snapshot warnings", "", ...report.warnings.map(w => `- ${w}`), ""] : []),
    "## Branches", "", table(["Branch", "Lane / state", "Tip / commit date", "Checkout (retiring marked)", "Landed state", "Unmatched diffstat", "Proposed action", "Reason / archive ref"], report.branches.map(b => [b.name, `${b.lane} / ${b.state}`, `${b.sha.slice(0, 12)} / ${b.date}`, b.checkedOut.map(p => p + (b.retiringCheckouts.includes(p) ? " (retiring)" : "")).join("; ") || "none", b.stateOfLanding, diffstat(b.unmatchedDiffstat), b.proposal.action, [b.proposal.reason, b.proposal.archiveRef].filter(Boolean).join("; ")])), "",
    "## Worktrees", "", table(["Path", "Branch / detached HEAD", "Prunable / locked", "Last modified", "Status / inputs / missing inputs", "target size", "Proposed action / reason / archive"], report.worktrees.map(w => [w.path, w.branch ?? `detached ${w.sha.slice(0, 12)}`, [w.prunable && `prunable: ${w.prunable}`, w.locked && `locked: ${w.locked}`].filter(Boolean).join("; ") || "no", w.lastModifiedAt, `${w.missing ? "MISSING" : w.dirty === null ? "UNKNOWN" : w.dirty ? "DIRTY" : w.buildOutputs.length ? "build outputs only" : "clean"}; ${w.inputs.length} INPUTS; ${w.missingInputs.length} MISSING INPUTS`, `${gib(w.target.bytes)}${w.target.sharedWith.length ? " (shared)" : ""}`, `${w.proposal.action}: ${w.proposal.reason}${w.proposal.archiveRef ? `; ${w.proposal.archiveRef}` : ""}`])), "",
    "## Archive refs by lane", "", table(["Lane", "Count"], Object.entries(report.totals.archivesByLane)), "",
    "Unknown archive ownership includes legacy flat names with no lanes.json prefix match. Every archive ref is retained; exact names and tips are in JSON.", "",
    "## Unmatched branch commits", ""];
  for (const b of report.branches.filter(b => b.unmatched.length || b.errors.length)) lines.push(`### ${cell(b.name)} (${b.stateOfLanding})`, "", ...b.errors.map(e => cell(e)), table(["SHA", "Commit date", "Subject", "Diffstat"], b.unmatched.map(c => [c.sha, c.date, c.subject, diffstat(c.diffstat)])), "");
  lines.push("## Worktree changes and inspection errors", "");
  for (const w of report.worktrees.filter(w => w.tracked.length || w.untracked.length || w.inputs.length || w.missingInputs.length || w.errors.length || w.notes.length)) {
    lines.push(`### ${cell(w.path)}`, "", "Tracked changes:", "", w.tracked.length ? table(["Status", "Path", "From", "Snapshot?"], w.tracked.map(c => [c.status, c.path, c.from, buildOutput(c.path) ? "excluded build output" : "yes"])) : "None recorded.", "", "Untracked non-ignored files:", "", w.untracked.length ? table(["Path", "Snapshot?"], w.untracked.map(p => [p, buildOutput(p) ? "excluded build output" : "yes"])) : "None recorded.", "", "Linked/patched inputs (not work):", "", w.inputs.length ? table(["Status", "Path", "Reason", "Symlink", "Target"], w.inputs.map(i => [i.status, i.path, i.reason, i.link, i.target])) : "None.", "", "Missing inputs (pure third_party/ deletions; content retained in HEAD):", "", w.missingInputs.length ? table(["Status", "Path"], w.missingInputs.map(i => [i.status, i.path])) : "None.", "", ...w.notes.map(n => `Note: ${cell(n)}`), ...w.errors.map(e => `Inspection error: ${cell(e)}`), "");
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  let repo = process.cwd(), out = join(homedir(), ".cache/nts-scratch/branch-inventory");
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if ((arg === "--repo" || arg === "--out") && process.argv[i + 1]) {
      const value = resolve(process.argv[++i]);
      if (arg === "--repo") repo = value; else out = value;
    } else if (arg === "--help") { console.log("node tooling/lanes/branches.ts [--repo PATH] [--out PATH] (read-only; writes reports only)"); return; }
    else throw new Error(`Unknown/incomplete argument: ${arg}`);
  }
  const report = await inventory({ repo });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "inventory.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(out, "inventory.md"), markdown(report));
  console.log(JSON.stringify({ report: join(out, "inventory.md"), json: join(out, "inventory.json"), totals: report.totals, warnings: report.warnings }, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch(e => { console.error(e); process.exitCode = 1; });
