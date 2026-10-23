// Read-only inventory; proposals here never execute cleanup.
// node tooling/lanes/branches.ts [--repo PATH] [--out PATH]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type LaneState = "ACTIVE" | "PAUSED" | "CLOSED" | "INACTIVE" | "UNKNOWN";
type Landed = "ANCESTOR" | "LANDED" | "PROBABLY-LANDED" | "UNLANDED" | "UNKNOWN";
type Action = { action: string; reason: string; archiveRef?: string };
type Diffstat = { files: number; insertions: number; deletions: number; binaryFiles: number };
type Commit = { sha: string; parents: string[]; timestamp: number; date: string; subject: string; diffstat?: Diffstat };
type Ref = { ref: string; sha: string };
type Lane = { lane: string; state: LaneState; source: string };
type Branch = Ref & Lane & {
  name: string; date: string; ageDays: number; checkedOut: string[]; stateOfLanding: Landed;
  mergeBase: string | null; unmatched: Commit[]; unmatchedDiffstat: Diffstat | null; errors: string[]; proposal: Action;
};
type Worktree = {
  path: string; sha: string; branch: string | null; detached: boolean; prunable: string | null;
  locked: string | null; active: string[]; protected: boolean; dirty: boolean | null;
  tracked: { status: string; path: string; from?: string }[]; untracked: string[];
  rootModifiedAt: string | null; lastModifiedAt: string | null;
  target: { path: string; realPath: string | null; bytes: number | null; sharedWith: string[] };
  errors: string[]; proposal: Action;
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
function owner(name: string, lanes: Record<string, { branch: string }>): Lane {
  const match = Object.entries(lanes).sort((a, b) => b[1].branch.length - a[1].branch.length).find(([, x]) => name.startsWith(x.branch));
  const lane = match?.[0] ?? (["sdk", "claude"].find(x => name.startsWith(`${x}/`))) ?? "unknown";
  return { lane, state: LANE_STATES[lane]?.state ?? "UNKNOWN", source: match ? "lanes.json prefix" : lane !== "unknown" ? "dated historical prefix" : "unrecognized prefix" };
}
function reachable(start: string, graph: Map<string, Commit>): Set<string> {
  const found = new Set<string>(), stack = [start];
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
        active: [], protected: false, dirty: null, tracked: [], untracked: [], rootModifiedAt: null, lastModifiedAt: null,
        target: { path: join(field.slice(9), "target"), realPath: null, bytes: null, sharedWith: [] }, errors: [],
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
function live(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
function defaultActive(home: string): Map<string, string[]> {
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
  const ctl = join(home, ".cache/nts-parallel-20261004/mainctl");
  try {
    const marker = readFileSync(join(ctl, "GATE-RUNNING"), "utf8");
    const pid = /\bpid\s+(\d+)/.exec(marker)?.[1];
    if (pid && live(Number(pid))) add(join(ctl, "gate-tree"), `Live landing marker PID ${pid}`);
  } catch { /* No marker means no detected landing. */ }
  return active;
}

function inspectWorktree(w: Worktree, active: Map<string, string[]>, protectedTree: string, sizeCache: Map<string, number>): void {
  w.active = active.get(canonical(w.path)) ?? [];
  w.protected = canonical(w.path) === canonical(protectedTree);
  let latest = 0;
  const noteTime = (path: string) => {
    try { latest = Math.max(latest, lstatSync(path).mtimeMs); }
    catch (e) { w.errors.push(`mtime ${path}: ${String(e)}`); }
  };
  try {
    w.rootModifiedAt = statSync(w.path).mtime.toISOString();
    noteTime(w.path);
    let complete = true, raw: string;
    try { raw = git(w.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]); }
    catch (e) {
      // Some old pin trees symlink a tracked submodule. Git refuses its
      // normal status; still list root changes, while keeping the inspection
      // incomplete and requiring a person to review the submodule.
      w.errors.push(String(e)); complete = false;
      raw = git(w.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"]);
    }
    const parsed = parseStatus(raw);
    Object.assign(w, parsed);
    const rootDirty = parsed.tracked.length > 0 || parsed.untracked.length > 0;
    w.dirty = rootDirty ? true : complete ? false : null;
    // Timestamp means the newest visible non-ignored file, root directory or
    // per-worktree Git HEAD/index. Ignored build products are excluded.
    const paths = new Set([...git(w.path, ["ls-files", "-z"]).split("\0").filter(Boolean), ...w.untracked]);
    for (const path of paths) if (existsSync(join(w.path, path))) noteTime(join(w.path, path));
    for (const name of ["HEAD", "index"]) {
      const path = git(w.path, ["rev-parse", "--path-format=absolute", "--git-path", name]).trim();
      if (existsSync(path)) noteTime(path);
    }
  } catch (e) { w.errors.push(String(e)); }
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
  const checked = trees.filter(w => b.checkedOut.includes(w.path));
  if (checked.some(w => w.dirty || w.errors.length)) return { action: "NEEDS A PERSON", reason: "Checked-out worktree is dirty or inaccessible" };
  if (b.errors.length || b.stateOfLanding === "UNKNOWN") return { action: "NEEDS A PERSON", reason: b.errors.join("; ") || "Unknown landing state" };
  if (b.checkedOut.length) return { action: "keep", reason: "Checked out; branch deletion requires separate worktree review" };
  if (b.stateOfLanding === "ANCESTOR" || b.stateOfLanding === "LANDED") return { action: "delete branch", reason: "All commits retained on main; no checkout" };
  if (b.stateOfLanding === "PROBABLY-LANDED") return {
    action: "archive then delete", archiveRef: `refs/archive/${b.lane}/${b.name}`,
    reason: "Subject-only match may hide a changed body; retain the exact commits in an archive",
  };
  if (b.ageDays <= 3) return { action: "keep", reason: "Tip is at most three days old" };
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
  const active = options.activeTrees ? new Map(options.activeTrees.map(p => [canonical(p), ["Explicit active tree"]])) : defaultActive(home);
  const sizeCache = new Map<string, number>();
  for (const w of trees) inspectWorktree(w, active, options.protectedTree ?? dirname(common), sizeCache);
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
  for (const b of branches) {
    b.proposal = branchProposal(b, trees);
    if (b.proposal.archiveRef) {
      const previous = archives.find(a => a.ref === b.proposal.archiveRef);
      if (previous && previous.sha !== b.sha) b.proposal = { action: "NEEDS A PERSON", reason: "Proposed archive ref already points to a different commit" };
    }
  }
  const archivedTips = new Set(archives.map(a => a.sha));
  for (const w of trees) {
    if (w.dirty || w.errors.length || w.dirty === null) w.proposal = { action: "NEEDS A PERSON", reason: "Dirty, inaccessible or incompletely inspected worktree" };
    else if (w.protected) w.proposal = { action: "keep", reason: "Protected shared landing checkout" };
    else if (w.active.length) w.proposal = { action: "keep", reason: w.active.join("; ") };
    else if (w.locked) w.proposal = { action: "NEEDS A PERSON", reason: `Worktree is locked: ${w.locked}` };
    else if (w.detached && (onMain.has(w.sha) || archivedTips.has(w.sha))) w.proposal = { action: "remove worktree", reason: "Clean inactive detached tree; exact HEAD retained on main or in an archive ref" };
    else if (w.branch && archivedTips.has(w.sha)) w.proposal = { action: "remove worktree", reason: "Clean inactive tree; exact branch tip already archived (branch ref is kept while checked out)" };
    else w.proposal = { action: "NEEDS A PERSON", reason: "Checkout still retains work whose preservation/removal needs review" };
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
  return {
    generatedAt: new Date().toISOString(), startedAt, policyDate: now.toISOString(), repo: canonical(repo), main,
    policy: { source: STATE_SOURCE, laneStates: LANE_STATES, activeTrees: Object.fromEntries(active), protectedTree: options.protectedTree ?? dirname(common),
      timestampDefinition: "Newest mtime of visible tracked/untracked non-ignored files, root directory and per-worktree Git HEAD/index; ignored build products excluded.",
      targetDefinition: "du -s -B1 allocated bytes; target symlink resolved, nested symlinks not followed; shared real paths counted once in total.",
      landingDefinition: "Stable patch IDs restricted to main commits after the unique merge-base; subject-only matches are archived before proposed branch deletion (MainClaude, Orcode 5f16afb4-4064-4d43-bf56-573216406c5e).",
      diffstatDefinition: "Unmatched commits: unique file paths across the series; summed added/deleted lines; binary-file changes counted separately. Merges diff against the first parent; renames count as delete/add.",
      checkedOutRule: "Checked-out branches are kept; clean inactive worktrees may be proposed for removal only with exact HEAD already retained on main/archive." },
    totals: { branches: branches.length, landed: count(branches.map(b => b.stateOfLanding)), branchActions: count(branches.map(b => b.proposal.action)),
      worktrees: trees.length, dirtyWorktrees: trees.filter(w => w.dirty).length, inaccessibleOrIncompleteWorktrees: trees.filter(w => w.errors.length || w.dirty === null).length,
      worktreeActions: count(trees.map(w => w.proposal.action)), archiveRefs: archives.length, archivesByLane: archiveCounts,
      uniqueTargetBytes: [...sizeCache.values()].reduce((a, b) => a + b, 0), uniqueTargetPaths: sizeCache.size,
      unknownTargetSizes: trees.filter(w => w.target.bytes === null).length,
      mainPatchIdPasses: 1, mainPatchIds: mainIds.size, otherPatchIdCommits: otherIds.size },
    warnings, branches, worktrees: trees, archives: archiveItems,
  };
}

export function markdown(report: Awaited<ReturnType<typeof inventory>>): string {
  const cell = (s: unknown) => String(s ?? "—").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("|", "&#124;").replaceAll("\n", "<br>");
  const table = (headers: string[], rows: unknown[][]) => [headers.join(" | "), headers.map(() => "---").join(" | "), ...rows.map(r => r.map(cell).join(" | "))].join("\n");
  const gib = (bytes: number | null) => bytes === null ? "unknown" : `${(bytes / 2 ** 30).toFixed(3)} GiB`;
  const diffstat = (d: Diffstat | null | undefined) => d ? `${d.files} files; +${d.insertions}/-${d.deletions}${d.binaryFiles ? `; ${d.binaryFiles} binary changes` : ""}` : "—";
  const lines = ["# Branch and worktree inventory", "", `Snapshot ${report.startedAt} – ${report.generatedAt}; main ${report.main}.`, "",
    "## Totals", "", table(["Item", "Count"], Object.entries(report.totals).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v])), "",
    "Proposals only. No Git refs, indexes, worktrees or build outputs are changed by this tool. Approval and cleanup require a separate step.", "",
    `Lane policy: ${report.policy.source}.`, "", table(["Lane / historical prefix", "State", "Since"], Object.entries(report.policy.laneStates).map(([k, v]) => [k, v.state, v.since])), "",
    `Protected checkout: ${report.policy.protectedTree}. Active trees:`, "",
    table(["Path", "Reason"], Object.entries(report.policy.activeTrees).map(([p, why]) => [p, why.join("; ")])), "",
    report.policy.timestampDefinition, report.policy.targetDefinition, report.policy.landingDefinition, report.policy.diffstatDefinition, report.policy.checkedOutRule, "",
    ...(report.warnings.length ? ["## Snapshot warnings", "", ...report.warnings.map(w => `- ${w}`), ""] : []),
    "## Branches", "", table(["Branch", "Lane / state", "Tip / commit date", "Checkout", "Landed state", "Unmatched diffstat", "Proposed action", "Reason / archive ref"], report.branches.map(b => [b.name, `${b.lane} / ${b.state}`, `${b.sha.slice(0, 12)} / ${b.date}`, b.checkedOut.join("; ") || "none", b.stateOfLanding, diffstat(b.unmatchedDiffstat), b.proposal.action, [b.proposal.reason, b.proposal.archiveRef].filter(Boolean).join("; ")])), "",
    "## Worktrees", "", table(["Path", "Branch / detached HEAD", "Prunable / locked", "Last modified", "Status", "target size", "Proposed action / reason"], report.worktrees.map(w => [w.path, w.branch ?? `detached ${w.sha.slice(0, 12)}`, [w.prunable && `prunable: ${w.prunable}`, w.locked && `locked: ${w.locked}`].filter(Boolean).join("; ") || "no", w.lastModifiedAt, w.dirty === null ? "UNKNOWN" : w.dirty ? "DIRTY" : "clean", `${gib(w.target.bytes)}${w.target.sharedWith.length ? " (shared)" : ""}`, `${w.proposal.action}: ${w.proposal.reason}`])), "",
    "## Archive refs by lane", "", table(["Lane", "Count"], Object.entries(report.totals.archivesByLane)), "",
    "Unknown archive ownership includes legacy flat names with no lanes.json prefix match. Every archive ref is retained; exact names and tips are in JSON.", "",
    "## Unmatched branch commits", ""];
  for (const b of report.branches.filter(b => b.unmatched.length || b.errors.length)) lines.push(`### ${cell(b.name)} (${b.stateOfLanding})`, "", ...b.errors.map(e => cell(e)), table(["SHA", "Commit date", "Subject", "Diffstat"], b.unmatched.map(c => [c.sha, c.date, c.subject, diffstat(c.diffstat)])), "");
  lines.push("## Worktree changes and inspection errors", "");
  for (const w of report.worktrees.filter(w => w.tracked.length || w.untracked.length || w.errors.length)) {
    lines.push(`### ${cell(w.path)}`, "", "Tracked changes:", "", w.tracked.length ? table(["Status", "Path", "From"], w.tracked.map(c => [c.status, c.path, c.from])) : "None recorded.", "", "Untracked non-ignored files:", "", w.untracked.length ? table(["Path"], w.untracked.map(p => [p])) : "None recorded.", "", ...w.errors.map(e => `Inspection error: ${cell(e)}`), "");
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
