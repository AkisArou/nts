import { instrumentPolicy } from "../step-result.ts";
import { toolingSlice } from "../tooling-slice.ts";

export type GateRow = { name: string; verdict: string; instrument?: unknown; cancelled_by?: unknown; [key: string]: unknown };
export type TrainRedStop = {
  version: 1; commit: string; members: number; trigger: string; cancelled: string[];
  decided_at: string; drained_at: string;
};

/** An instrument's exit code cannot turn its hold into a completed failure. */
export function definiteFailure(row: GateRow): boolean {
  if (row.verdict !== "FAIL" || row.cancelled_by !== undefined) return false;
  if (row.instrument === undefined) return row.signal == null && (row.exit === undefined
    || typeof row.exit === "number" && Number.isSafeInteger(row.exit) && row.exit > 0 && row.exit < 128);
  if (typeof row.instrument !== "object" || row.instrument === null) return false;
  const result = row.instrument as Record<string, unknown>;
  const policy = instrumentPolicy(result.kind, result.completedFailures);
  return policy?.disposition === "verdict" && policy.verdict === "FAIL" && result.verdict === "FAIL";
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const names = (value: unknown): value is string[] => Array.isArray(value) && value.every(name => typeof name === "string" && name.length > 0)
  && new Set(value).size === value.length;
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Validate cancellation before excluding any NOT RUN row from attribution. */
export function readTrainRedStop(summary: Record<string, unknown>, commit: string, members: number, requested: string[]): TrainRedStop | undefined {
  const rows = summary.steps;
  if (!Array.isArray(rows) || rows.some(row => !object(row) || typeof row.name !== "string" || typeof row.verdict !== "string")) throw new Error("red-stop proof lacks step rows");
  const steps = rows as GateRow[];
  if (steps.some(row => !["PASS", "FAIL", "INSTRUMENT", "NOT RUN", "SKIPPED"].includes(row.verdict)
      || row.verdict === "FAIL" && !definiteFailure(row))) throw new Error("unproved completed verdict in red-stop summary");
  if (summary.scope_execution === true) {
    const root = summary.scope_root;
    if (!object(summary.scope_cleanup) || summary.scope_cleanup.state !== "complete") throw new Error("step scope cleanup is incomplete");
    if (steps.some(row => row.started_at !== undefined)) {
      if (!object(root) || typeof root.slice !== "string" || typeof root.group !== "string" || !root.group.startsWith("/")
          || !root.group.endsWith(`/${root.slice}`) || root.group.split("/").includes("..")) throw new Error("step scope root is missing or foreign");
      toolingSlice({ NTS_TOOLING_SLICE: root.slice });
      for (const row of steps.filter(row => row.started_at !== undefined)) {
        const proof = row.scope;
        if (!object(proof) || JSON.stringify(Object.keys(proof).sort()) !== JSON.stringify(["version", "slice", "unit", "group", "device", "inode", "populated", "observed_at"].sort())
            || proof.version !== 1 || typeof proof.slice !== "string" || !proof.slice.startsWith(`${root.slice.slice(0,-6)}-run`)
            || typeof proof.group !== "string" || !proof.group.startsWith(`${root.group}/`) || !proof.group.endsWith(`/${proof.slice}`)
            || proof.group.split("/").includes("..") || proof.unit !== `${proof.slice.slice(0,-6)}-step.scope`
            || !/^\d+$/.test(String(proof.device)) || !/^[1-9]\d*$/.test(String(proof.inode))
            || proof.populated !== 0 || !timestamp(proof.observed_at)) throw new Error(`step cgroup drain is not proved: ${row.name}`);
        toolingSlice({ NTS_TOOLING_SLICE: proof.slice });
        if (["PASS", "FAIL", "SKIPPED"].includes(row.verdict)) {
          const entry = row.scope_entry;
          if (!object(entry) || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["version", "nonce", "unit", "group"].sort())
              || entry.version !== 1 || entry.unit !== proof.unit || entry.group !== `${proof.group}/${proof.unit}`
              || typeof entry.nonce !== "string" || !/^[a-f0-9-]{36}$/.test(entry.nonce)) throw new Error(`step scope entry is not proved: ${row.name}`);
        }
      }
    }
  }
  if (!names(requested) || steps.length !== requested.length || new Set(steps.map(row => row.name)).size !== steps.length
      || steps.some(row => !requested.includes(row.name))) throw new Error("red-stop proof has foreign, duplicate or missing rows");
  const raw = summary.train_red_stop;
  if (raw === undefined) {
    if (steps.some(row => row.cancelled_by !== undefined) || members > 1 && steps.some(row => definiteFailure(row) || row.verdict === "NOT RUN")) throw new Error("missing multi-member red-stop proof");
    return;
  }
  const keys = ["version", "commit", "members", "trigger", "cancelled", "decided_at", "drained_at"].sort();
  if (!object(raw) || JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(keys) || raw.version !== 1
      || !/^[0-9a-f]{40}$/.test(commit) || raw.commit !== commit || raw.members !== members || !Number.isSafeInteger(members) || members < 2
      || typeof raw.trigger !== "string" || !names(raw.cancelled) || !timestamp(raw.decided_at) || !timestamp(raw.drained_at)
      || raw.decided_at > raw.drained_at || summary.interrupted !== null || summary.fail_fast !== false
      || summary.verdict !== "red" || !object(summary.environment) || summary.environment.canonical !== true) throw new Error("invalid multi-member red-stop context");
  const trigger = steps.find(row => row.name === raw.trigger);
  if (!trigger || !definiteFailure(trigger)) throw new Error("red-stop trigger is not a completed definite failure");
  const cancelled = steps.filter(row => row.cancelled_by !== undefined);
  if (cancelled.some(row => row.verdict !== "NOT RUN" || row.cancelled_by !== raw.trigger || row.instrument !== undefined
      || row.started_at !== undefined && !["SIGTERM", "SIGKILL"].includes(String(row.signal)))
      || JSON.stringify(cancelled.map(row => row.name).sort()) !== JSON.stringify([...raw.cancelled].sort())) throw new Error("red-stop cancellation set contradicts its rows");
  if (steps.some(row => row.verdict === "NOT RUN" && row.cancelled_by === undefined)) throw new Error("unproved unfinished row in red-stop summary");
  return raw as TrainRedStop;
}
