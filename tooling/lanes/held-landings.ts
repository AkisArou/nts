// A hang holds exactly one frozen batch. Operator resolutions are write-ahead.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { durableRecord } from "./durable-record.ts";

export type HeldEntry = { id: string; sha: string; [key: string]: unknown };
export type HeldBatch = { version: 1; id: string; tip: string; generation: string; run: string; reason: string; entries: HeldEntry[] };
export type HeldResolution = { version: 1; hold: string; entry: string; action: "retry" | "refuse"; note: string; phase: "prepared" | "applied" };
export type HeldLanding = { batch: HeldBatch; entry: HeldEntry };
const safe = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id);
const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const batches = (state: string) => join(state, "held-landings/batches");
const resolutions = (state: string) => join(state, "held-landings/resolutions");
function files(directory: string): string[] {
  return existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith(".json")).sort() : [];
}
function readBatch(path: string): HeldBatch {
  const row = JSON.parse(readFileSync(path, "utf8"));
  if (row.version !== 1 || typeof row.id !== "string" || !safe(row.id) || !sha(row.tip) || typeof row.generation!=="string" || !safe(row.generation)
      || typeof row.run !== "string" || !isAbsolute(row.run) || typeof row.reason !== "string" || !row.reason.trim()
      || !Array.isArray(row.entries) || !row.entries.length || row.entries.some(entry => !entry || typeof entry.id !== "string" || !safe(entry.id) || !sha(entry.sha))
      || new Set(row.entries.map(entry => entry.id)).size !== row.entries.length) throw new Error(`invalid held batch: ${path}`);
  return row;
}
function resolutionFile(state: string, hold: string, entry: string): string {
  if (!safe(hold) || !safe(entry)) throw new Error("invalid held resolution identity");
  return join(resolutions(state), `${hold}--${entry}.json`);
}
function readResolution(path: string): HeldResolution {
  const row = JSON.parse(readFileSync(path, "utf8"));
  if (row.version !== 1 || typeof row.hold !== "string" || !safe(row.hold) || typeof row.entry !== "string" || !safe(row.entry)
      || !["retry", "refuse"].includes(row.action) || !["prepared", "applied"].includes(row.phase)
      || typeof row.note !== "string" || !row.note.trim()) throw new Error(`invalid held resolution: ${path}`);
  return row;
}

/** All frozen members become held through one atomic record, before a boundary. */
export function holdLandings(state: string, input: Omit<HeldBatch, "version" | "id">): HeldBatch {
  if (!sha(input.tip) || !safe(input.generation) || !isAbsolute(input.run) || !input.reason.trim() || !input.entries.length
      || input.entries.some(entry => !safe(entry.id) || !sha(entry.sha))
      || new Set(input.entries.map(entry => entry.id)).size !== input.entries.length) throw new Error("invalid held batch input");
  const id = `${input.tip}-${createHash("sha256").update(input.run).digest("hex").slice(0, 16)}`;
  const row: HeldBatch = { version: 1, id, ...input };
  const path = join(batches(state), `${id}.json`);
  if (existsSync(path)) {
    const previous = readBatch(path);
    if (JSON.stringify(previous) !== JSON.stringify(row)) throw new Error(`held batch changed: ${id}`);
    return previous;
  }
  const active = new Set(heldLandings(state).map(row => row.entry.id));
  if (input.entries.some(entry => active.has(entry.id))) throw new Error("an entry already belongs to an unresolved held batch");
  durableRecord(path, row);
  return row;
}

export function heldBatches(state:string):HeldBatch[] {
  return files(batches(state)).map(name=>{
    const batch=readBatch(join(batches(state),name));
    if(name!==`${batch.id}.json`)throw new Error(`held batch filename mismatch: ${name}`);
    return batch;
  });
}
export function heldLandings(state: string): HeldLanding[] {
  const active: HeldLanding[] = [];
  for (const batch of heldBatches(state)) {
    for (const entry of batch.entries) {
      const path = resolutionFile(state, batch.id, entry.id);
      const resolution = existsSync(path) ? readResolution(path) : undefined;
      if (resolution && (resolution.hold !== batch.id || resolution.entry !== entry.id)) throw new Error(`held resolution identity mismatch: ${path}`);
      if (resolution?.phase !== "applied") active.push({ batch, entry });
    }
  }
  if (new Set(active.map(row => row.entry.id)).size !== active.length) throw new Error("one entry belongs to multiple unresolved held batches");
  return active;
}

/** A resolved hold also retires its old frozen composition. */
export function wasHeldGeneration(state: string, generation: string | undefined): boolean {
  return heldBatches(state).some(batch=>batch.generation===generation);
}

/** A descendant remains queued behind the exact unresolved prerequisite. */
export function heldForEntry(state: string, id: string, active = heldLandings(state)): HeldLanding | undefined {
  const own = active.find(row=>row.entry.id===id);
  if(own)return own;
  if(!safe(id))throw new Error("invalid held dependency identity");
  const path=join(state,"held-dependencies",`${id}.json`);
  if(!existsSync(path))return;
  const dependency=JSON.parse(readFileSync(path,"utf8"));
  if(typeof dependency.hold!=="string"||!safe(dependency.hold)||typeof dependency.prerequisite!=="string"||!safe(dependency.prerequisite))throw new Error(`invalid held dependency: ${path}`);
  return active.find(row=>row.batch.id===dependency.hold&&row.entry.id===dependency.prerequisite);
}

export function heldActions(row: HeldLanding): { retry: string; refuse: string } {
  const identity=`${row.batch.id}:${row.entry.id}`;
  return {retry:`node tooling/lanes/land.ts --retry-held ${identity} --because=<note>`,refuse:`node tooling/lanes/land.ts --refuse-held ${identity} --because=<note>`};
}

/** Caller holds the operator lock. The selected action is durable before effects. */
export function prepareHeldResolution(state: string, hold: string, entry: string, action: HeldResolution["action"], note: string): HeldResolution {
  if (!safe(hold) || !safe(entry)) throw new Error("invalid held resolution identity");
  const batch = readBatch(join(batches(state), `${hold}.json`));
  if (batch.id !== hold || !batch.entries.some(row => row.id === entry) || !note.trim() || !["retry", "refuse"].includes(action)) throw new Error("invalid held resolution request");
  const path = resolutionFile(state, hold, entry);
  if (existsSync(path)) {
    const previous = readResolution(path);
    if (previous.hold !== hold || previous.entry !== entry || previous.action !== action || previous.note !== note) throw new Error("held resolution already has a different operator decision");
    return previous;
  }
  const row: HeldResolution = { version: 1, hold, entry, action, note, phase: "prepared" };
  durableRecord(path, row);
  return row;
}

export function pendingHeldResolutions(state: string): { resolution: HeldResolution; batch: HeldBatch; entry: HeldEntry }[] {
  return files(resolutions(state)).flatMap(name => {
    const resolution = readResolution(join(resolutions(state), name));
    if (name !== `${resolution.hold}--${resolution.entry}.json`) throw new Error(`held resolution filename mismatch: ${name}`);
    const batch = readBatch(join(batches(state), `${resolution.hold}.json`));
    const entry = batch.entries.find(row => row.id === resolution.entry);
    if (!entry || batch.id !== resolution.hold) throw new Error("held resolution lost its batch member");
    return resolution.phase === "prepared" ? [{ resolution, batch, entry }] : [];
  });
}

/** Call only after the queue/result operation has finished durably. */
export function appliedHeldResolution(state: string, decision: HeldResolution): void {
  const path = resolutionFile(state, decision.hold, decision.entry);
  const previous = readResolution(path);
  if (previous.hold !== decision.hold || previous.entry !== decision.entry || previous.action !== decision.action || previous.note !== decision.note) throw new Error("held resolution changed before application");
  if (previous.phase === "applied") return;
  durableRecord(path, { ...previous, phase: "applied" });
}
