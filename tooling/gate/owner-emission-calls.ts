// Observation-only owner-emission accounting. Missing evidence is never zero.
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export type OwnerEmissionCount={project:string;nodeVersion:string;emits:number;hits:number;held:number;inputIdentities:string[]};
export type OwnerEmissionReport=
  |{status:'unavailable'|'invalid'|'missing'|'unreadable';ledger?:string;reason:string}
  |{status:'complete'|'in-progress'|'incomplete';ledger:string;emits:number;hits:number;held:number;owners:OwnerEmissionCount[]};
type RawObservation={version?:unknown;project?:unknown;directory?:unknown;step?:unknown;nodeVersion?:unknown;mode?:unknown;inputsSha256?:unknown};

export function ownerEmissionCalls(capability:unknown, { step, drained = false }:{step?:string|null;drained?:boolean} = {}):OwnerEmissionReport {
  const capture=capability as {directory?:unknown;admission?:{kind?:string}}|undefined;
  let ledger;
  try {
    if (!["gate", "standalone"].includes(capture?.admission?.kind??""))
      return { status: "unavailable", reason: "no owned oracle capture" };
    const directory=capture?.directory;
    if (typeof directory !== "string" || !isAbsolute(directory))
      return { status: "invalid", reason: "invalid owner capture directory" };
    ledger = join(directory, "oracle-owner-calls.jsonl");
    const lines = readFileSync(ledger, "utf8").split("\n"), trailing = lines.pop(), owners = new Map<string,Omit<OwnerEmissionCount,"inputIdentities">&{inputIdentities:Set<string>}>();
    for (const line of lines) {
      const row = JSON.parse(line) as RawObservation, part = typeof row.directory === "string" ? relative(directory, row.directory) : "..";
      if (row.version !== 1 || typeof row.project !== "string" || !isAbsolute(row.project) ||
          (row.step !== null && typeof row.step !== "string") || typeof row.nodeVersion !== "string" ||
          !["emit", "hit", "held"].includes(row.mode as string) || !/^[a-f0-9]{64}$/.test(row.inputsSha256 as string) ||
          isAbsolute(part) || part === ".." || part.startsWith(".." + sep))
        return { status: "invalid", ledger, reason: "invalid owner emission observation" };
      if (step !== undefined && row.step !== step) continue;
      const key = JSON.stringify([row.project, row.nodeVersion]);
      const owner = owners.get(key) ?? { project: row.project, nodeVersion: row.nodeVersion, emits: 0, hits: 0, held: 0, inputIdentities: new Set<string>() };
      owner[row.mode === "emit" ? "emits" : row.mode === "hit" ? "hits" : "held"]++;
      owner.inputIdentities.add(row.inputsSha256 as string); owners.set(key, owner);
    }
    const rows = [...owners.values()].map(owner => ({ ...owner, inputIdentities: [...owner.inputIdentities] }));
    return { status: trailing ? drained ? "incomplete" : "in-progress" : "complete", ledger,
      emits: rows.reduce((sum, row) => sum + row.emits, 0), hits: rows.reduce((sum, row) => sum + row.hits, 0),
      held: rows.reduce((sum, row) => sum + row.held, 0), owners: rows };
  } catch (error) {
    const issue=error as NodeJS.ErrnoException;
    return { status: issue.code === "ENOENT" ? "missing" : "unreadable", ledger, reason: issue.message };
  }
}
