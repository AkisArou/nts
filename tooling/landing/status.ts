// Read-only landing status acquisition and reporting, safe to import.
import {join} from 'node:path';
import {issueOfBranch} from '../tasks/branch.ts';
import {revParse} from './git.ts';
import {holder} from './lock.ts';
import {describePool,Pool,type PoolTree} from './pool.ts';
import {Queue,SERVICE_UNIT,type Checking,type Entry,type Result,type Status} from './queue.ts';
const short=(sha:string)=>sha.slice(0,12);

/** A change as the status gives it, with the issue its task's branch names. */
export type Change = { id: string; sha: string; branch: string | null; issue: number | null; by: string; first: boolean; submitted_at: string; note: string | null };
/** An answer as the status gives it: its times in seconds, as numbers. */
export type Answer = {
  id: string; sha: string; state: Result["state"]; at: string; message: string; branch: string | null; issue: number | null;
  base: string | null; tip: string | null; run: string | null; wall_s: number | null; estimate_s: number | null;
  landing: string[]; deferred: string[]; pending: number;
};
/**
 * The landing check as `status --json` prints it, version 1: the service, the
 * change being checked, the queue, the last day's answers and the recent
 * ones, main and the pool. Times are ISO strings; durations are seconds, as
 * numbers. The text `status` prints is rendered from this.
 *
 * Other tools read it (signalbox's Landing tab), so within a version fields
 * are only added; one removed, renamed or reshaped bumps `version`.
 */
export type LandingStatus = {
  version: 1; kind: "landing"; at: string;
  service: { running: boolean; pid: number | null; unit: string; state: Status["state"]; since: string; message: string | null;run:string|null };
  checking: (Change & { phase: Checking["phase"] | null; base: string | null; tip: string | null; run: string | null; started_at: string; seconds: number }) | null;
  waiting: Change[];
  held: (Change & { message: string })[];
  /** The answers of the last 24 hours by state, and how long the landed ones' checks took. */
  day: { landed: number; refused: number; held: number; withdrawn: number; median_wall_s: number | null; max_wall_s: number | null };
  /** The newest answers, oldest first. */
  recent: Answer[];
  /** Whether origin has main, by the remote-tracking ref the service's pushes move: the status never asks the network. */
  main: { commit: string | null; pushed: boolean | null };
  pool: { home: string; trees: (PoolTree & { issue: number | null })[] };
};

const RECENT = 50;
const DAY_MS = 86_400_000;

export function landingStatus(root: string, home:string, pool:string, now:number, poolOwner:Pick<Pool,'statusTrees'>=new Pool(pool,{root})): LandingStatus {
  const queue = new Queue(home), s = queue.status(), pid = holder(join(home, "serve.lock"));
  const issue = (branch: string | null) => branch === null ? null : issueOfBranch(branch);
  const change = (e: Entry): Change => ({ id: e.id, sha: e.sha, branch: e.branch, issue: issue(e.branch), by: e.by, first: e.first, submitted_at: e.submitted_at, note: e.note ?? null });
  const checking = queue.checking(), results = queue.results();
  const day = results.filter(r => now - Date.parse(r.at) < DAY_MS);
  const walls = day.flatMap(r => r.state === "landed" && typeof r.wall_s === "number" ? [r.wall_s] : []).sort((a, b) => a - b);
  const count = (state: Result["state"]) => day.filter(r => r.state === state).length;
  const ref = (name: string) => { try { return revParse({ root }, name); } catch { return null; } };
  const main = ref("refs/heads/main"), remote = ref("refs/remotes/origin/main");
  return {
    version: 1, kind: "landing", at: new Date(now).toISOString(),
    service: { running: pid !== null, pid, unit: SERVICE_UNIT, state: s.state, since: s.since ?? s.at, message: s.message ?? null,run:s.run??null },
    checking: checking && { ...change(checking), phase: checking.phase ?? null, base: checking.base ?? null, tip: checking.tip ?? null, run: checking.run ?? null,
      started_at: checking.started_at, seconds: Math.round((now - Date.parse(checking.started_at)) / 1000) },
    waiting: queue.waiting().map(change),
    held: queue.held().map(e => ({ ...change(e), message: queue.result(e.id)?.message ?? "" })),
    day: { landed: count("landed"), refused: count("refused"), held: count("held"), withdrawn: count("withdrawn"),
      median_wall_s: walls.length ? walls[Math.floor((walls.length - 1) / 2)]! : null, max_wall_s: walls.at(-1) ?? null },
    recent: results.slice(-RECENT).map(r => ({
      id: r.id, sha: r.sha, state: r.state, at: r.at, message: r.message, branch: r.task ?? null, issue: issue(r.task ?? null),
      base: r.base ?? null, tip: r.tip ?? null, run: r.run ?? null, wall_s: r.wall_s ?? null, estimate_s: r.estimate_s ?? null,
      landing: r.landing ?? [], deferred: r.deferred ?? [], pending: r.pending?.length ?? 0,
    })),
    main: { commit: main, pushed: main === null || remote === null ? null : main === remote },
    pool: { home: pool, trees: poolOwner.statusTrees().map(tree => ({ ...tree, issue: issue(tree.branch) })) },
  };
}

const minutes = (seconds: number) => `${(seconds / 60).toFixed(1)} min`;

/** The status as `status` prints it, from the same model `--json` prints. */
export function statusText(m: LandingStatus): string {
  const lines = [`service: ${m.service.running ? `draining (process ${m.service.pid}, unit ${m.service.unit})` : "not running"}; ${m.service.state} since ${m.service.since}${m.service.message ? `: ${m.service.message}` : ""}`];
  const c = m.checking;
  if (c) lines.push(`checking: ${c.id} ${c.branch ?? "(no branch)"} ${c.phase ?? ""}${c.tip ? ` as ${short(c.tip)}` : ""}${c.run ? `, logs ${c.run}` : ""}`);
  lines.push(`waiting (${m.waiting.length}):${m.waiting.length ? "" : " none"}`);
  m.waiting.forEach((e, i) => lines.push(`  ${i + 1}. ${e.id} ${e.branch ?? "(no branch)"} by ${e.by}${e.first ? ", first" : ""}${e.note ? ` -- ${e.note}` : ""}`));
  if (m.held.length) { lines.push(`held (${m.held.length}): retry with \`check.ts retry <id>\` or withdraw`); for (const e of m.held) lines.push(`  ${e.id} ${e.branch ?? ""}: ${e.message}`); }
  const recent = m.recent.slice(-8);
  lines.push(`recent (${recent.length}):`);
  for (const r of recent) lines.push(`  ${r.at.slice(0, 16).replace("T", " ")} ${r.state.padEnd(9)} ${short(r.sha)} ${r.message}`);
  const d = m.day;
  lines.push(`last day: ${d.landed} landed${d.median_wall_s !== null && d.max_wall_s !== null ? ` (median ${minutes(d.median_wall_s)}, longest ${minutes(d.max_wall_s)})` : ""}, ${d.refused} refused, ${d.held} held, ${d.withdrawn} withdrawn`);
  if (m.main.commit && m.main.pushed !== null) lines.push(`main ${short(m.main.commit)}: ${m.main.pushed ? "on origin" : "NOT on origin yet"}`);
  lines.push(`pool ${m.pool.home}:\n${describePool(m.pool.trees)}`);
  return lines.join("\n");
}

export function reportLandingStatus(model:LandingStatus,json:boolean): number {
  console.log(json ? JSON.stringify(model, null, 2) : statusText(model));
  return 0;
}

