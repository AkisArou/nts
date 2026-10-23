import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { archiveCoverage, readArchives } from "./archive.ts";
import { classifyHistory } from "./history.ts";
function git(repo: string, args: string[]): string {
  if (!["for-each-ref", "rev-parse"].includes(args[0])) throw new Error("Non-read-only branch health command");
  const r = spawnSync("git", ["--no-optional-locks", "-C", repo, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" }, encoding: "utf8" });
  if (r.error || r.status) throw new Error(r.error?.message ?? r.stderr);
  return r.stdout.trim();
}
export async function branchHealth(repo: string, registry = join(repo, "tooling/lanes/archive.tsv"), now = new Date()) {
  const archiveRefs = git(repo, ["for-each-ref", "--format=%(refname)", "refs/archive/"]).split("\n").filter(Boolean);
  let missing = archiveRefs, absent: string[] = [], registryError: string | null = null;
  try { ({ missing, absent } = archiveCoverage(archiveRefs, readArchives(registry))); }
  catch (e) { registryError = String(e); }
  const heads = git(repo, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(committerdate:unix)", "refs/heads/"])
    .split("\n").filter(Boolean).map(l => { const [ref, sha, when] = l.split("\0"); return { ref, sha, timestamp: Number(when) }; })
    .filter(h => h.ref !== "refs/heads/main" && now.getTime() / 1000 - h.timestamp > 3 * 86400);
  const main = git(repo, ["rev-parse", "refs/heads/main"]);
  const history = heads.length ? await classifyHistory(repo, main, heads) : null;
  const unlanded = heads.flatMap(h => {
    const c = history!.classified.get(h.ref)!;
    return ["ANCESTOR", "LANDED"].includes(c.stateOfLanding) ? [] : [{ name: h.ref.slice(11), sha: h.sha, date: new Date(h.timestamp * 1000).toISOString(), state: c.stateOfLanding, unmatched: c.unmatched.length, errors: c.errors }];
  });
  return { unlanded, examinedOldBranches: heads.length, archiveRefCount: archiveRefs.length, archivesWithoutRegistry: missing, registryWithoutRefs: absent, registryError };
}
export function healthLines(health: Awaited<ReturnType<typeof branchHealth>>): string[] {
  const lines = [`unlanded branches older than 3 days: ${health.unlanded.length} of ${health.examinedOldBranches} old branches`];
  for (const b of health.unlanded) lines.push(`  ${b.name} ${b.sha.slice(0, 12)} ${b.date} ${b.state} (${b.unmatched} unmatched commits)${b.errors.length ? `: ${b.errors.join("; ")}` : ""}`);
  lines.push(`archive refs without a registry row: ${health.archivesWithoutRegistry.length} of ${health.archiveRefCount}`);
  for (const ref of health.archivesWithoutRegistry) lines.push(`  ${ref}`);
  if (health.registryWithoutRefs.length) lines.push("registry rows without refs:", ...health.registryWithoutRefs.map(r => `  ${r}`));
  if (health.registryError) lines.push(`archive registry error: ${health.registryError}`);
  return lines;
}
