// Only successful submissions are eligible; never sweep arbitrary branches.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseWorktrees } from "./branches.ts";
import { classifyHistory } from "./history.ts";
export type TopicEvent = { operation: string; item: string; status: string; reason?: string; [key: string]: unknown };
export function upkeepRecords(file: string): TopicEvent[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap(line => {
    try { const e = JSON.parse(line); return typeof e.operation === "string" && typeof e.item === "string" ? [e] : []; }
    catch { return []; } // Another originating process may be appending its line.
  });
}
export function recordedTopics(file: string): string[] {
  return [...new Set(upkeepRecords(file).filter(e => e.operation === "landed-submission" && e.status === "recorded").map(e => e.item))].sort();
}
export function upkeepStatus(file: string) {
  const last = new Map<string, TopicEvent>();
  for (const e of upkeepRecords(file)) if (e.operation === "revisit-landed-topic") last.set(e.item, e);
  return { recordedTopics: recordedTopics(file).length, latest: [...last.values()].reverse() };
}
export async function revisitLandedTopics(repo: string, recorded: string[], onEvent?: (event: TopicEvent) => void) {
  const events: TopicEvent[] = [];
  const emit = (event: TopicEvent) => { events.push(event); onEvent?.(event); };
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[key];
  const git = (args: string[]) => spawnSync("git", ["--no-optional-locks", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-C", repo, ...args], { env, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const read = (args: string[]) => { const r = git(args); if (r.error || r.status) throw new Error(r.error?.message ?? r.stderr); return r.stdout.trim(); };
  const checkedOut = (ref: string) => parseWorktrees(read(["worktree", "list", "--porcelain", "-z"])).some(w => `refs/heads/${w.branch}` === ref);
  const refs = new Map(read(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/"]).split("\n").filter(Boolean).map(l => l.split(" ") as [string, string]));
  const pending: { ref: string; sha: string }[] = [];
  for (const ref of [...new Set(recorded)]) {
    if (!ref.startsWith("refs/heads/") || ref === "refs/heads/main" || git(["check-ref-format", ref]).status) { emit({ operation: "revisit-landed-topic", item: ref, status: "skipped", reason: "invalid or protected topic ref" }); continue; }
    const sha = refs.get(ref);
    if (!sha) { emit({ operation: "revisit-landed-topic", item: ref, status: "already gone" }); continue; }
    if (checkedOut(ref)) { emit({ operation: "revisit-landed-topic", item: ref, status: "still checked out", sha }); continue; }
    pending.push({ ref, sha });
  }
  if (!pending.length) return events;
  const main = read(["rev-parse", "refs/heads/main"]), proof = await classifyHistory(repo, main, pending);
  for (const { ref, sha } of pending) {
    const c = proof.classified.get(ref)!;
    if (!["ANCESTOR", "LANDED"].includes(c.stateOfLanding)) { emit({ operation: "revisit-landed-topic", item: ref, status: "has unlanded commits", sha, landingState: c.stateOfLanding, unmatched: c.unmatched.map(c => c.sha) }); continue; }
    const guard = (): string | null => {
      if (git(["merge-base", "--is-ancestor", main, "refs/heads/main"]).status) return "main moved away from the classified history";
      if (git(["symbolic-ref", "--quiet", ref]).status === 0) return "symbolic topic ref";
      const current = git(["rev-parse", "--verify", "--quiet", ref]);
      if (current.status || current.stdout.trim() !== sha) return "ref moved since classification";
      return checkedOut(ref) ? "still checked out" : null;
    };
    let reason = guard();
    if (!reason) {
      const argv = ["update-ref", "--no-deref", "-d", ref, sha];
      emit({ operation: "delete-landed-topic", item: ref, status: "attempt", argv, sha });
      reason = guard();
      if (!reason) {
        const r = git(argv);
        if (r.status || r.error) reason = `topic CAS rejected: ${r.error?.message ?? r.stderr.trim()}`;
        else emit({ operation: "delete-landed-topic", item: ref, status: "done", sha });
      }
    }
    emit({ operation: "revisit-landed-topic", item: ref, status: reason === "still checked out" ? reason : reason ? "skipped" : "deleted", sha, ...(reason ? { reason } : {}) });
  }
  return events;
}
