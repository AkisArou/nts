// Shared, read-only patch equivalence for inventory, status and landing retirement.
import { spawn, spawnSync } from "node:child_process";
export type Landed = "ANCESTOR" | "LANDED" | "PROBABLY-LANDED" | "UNLANDED" | "UNKNOWN";
export type HistoryCommit = { sha: string; parents: string[]; timestamp: number; date: string; subject: string; diffstat?: { files: number; insertions: number; deletions: number; binaryFiles: number } };
type Ref = { ref: string; sha: string };
type Classification = { mergeBase: string | null; unmatched: HistoryCommit[]; stateOfLanding: Landed; errors: string[] };
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
const gitOptions = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];
function git(repo: string, args: string[]): string {
  if (!["log", "merge-base"].includes(args[0])) throw new Error("Non-read-only history command");
  const r = spawnSync("git", [...gitOptions, "-C", repo, ...args], { env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status) throw new Error(`${args[0]}: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout;
}
function reachable(start: string, graph: Map<string, HistoryCommit>): Set<string> {
  const found = new Set<string>(), stack = [start];
  while (stack.length) {
    const sha = stack.pop()!; if (found.has(sha)) continue;
    const c = graph.get(sha); if (!c) throw new Error(`Missing commit metadata: ${sha}`);
    found.add(sha); stack.push(...c.parents);
  }
  return found;
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


export async function classifyHistory(repo: string, main: string, heads: Ref[], extra: string[] = []) {
  const graph = new Map<string, HistoryCommit>();
  const fields = git(repo, ["log", "--all", main, ...heads.map(h => h.sha), ...extra.filter(Boolean), "--format=%H%x00%P%x00%ct%x00%cI%x00%s", "-z"]).split("\0");
  for (let i = 0; i + 4 < fields.length; i += 5) {
    const [sha, parents, timestamp, date, subject] = fields.slice(i, i + 5);
    graph.set(sha, { sha, parents: parents ? parents.split(" ") : [], timestamp: Number(timestamp), date, subject });
  }
  const onMain = reachable(main, graph), mainIds = await patchIds(repo, [main]);
  const idsOnMain = new Map<string, string[]>();
  for (const [sha, id] of mainIds) idsOnMain.set(id, [...(idsOnMain.get(id) ?? []), sha]);
  const ranges = new Map<string, string[]>(), excluded = new Map<string, Set<string>>(), needed = new Set<string>();
  const classified = new Map<string, Classification>();
  for (const r of heads) {
    const b: Classification = { mergeBase: null, unmatched: [], stateOfLanding: "UNKNOWN", errors: [] }; classified.set(r.ref, b);
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
  for (const r of heads) {
    const b = classified.get(r.ref)!;
    if (!b.mergeBase || b.errors.length) continue;
    const before = excluded.get(b.mergeBase)!;
    if (!subjects.has(b.mergeBase)) subjects.set(b.mergeBase, new Set([...onMain].filter(s => !before.has(s)).map(s => graph.get(s)!.subject)));
    const unmatched = ranges.get(r.sha)!.filter(sha => {
      if (onMain.has(sha) && !before.has(sha)) return false;
      const id = otherIds.get(sha);
      return !id || !(idsOnMain.get(id) ?? []).some(s => !before.has(s));
    });
    b.unmatched = unmatched.map(s => graph.get(s)!);
    b.stateOfLanding = unmatched.length === 0 ? "LANDED" : b.unmatched.every(c => subjects.get(b.mergeBase!)!.has(c.subject)) ? "PROBABLY-LANDED" : "UNLANDED";
  }
  return { graph, onMain, mainIds, otherIds, ranges, classified };
}
