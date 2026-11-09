// The delta of a records run (docs/workflow.md, Records): what the recorders
// wrote, case by case, so that the rows land by case and not as text. The full
// check records at the verified commit, which main has moved past by the time
// the rows land; a records commit made there and rebased as text was refused
// for a neighbouring line another commit deleted. So the recorder writes this
// delta (record-pending.ts --delta), and main's own record-pending.ts --apply
// merges it into a tree at main's tip, row by row: a row applies only where
// main left that case's row as it was and the case is still the one its row
// was measured from.
//
// One row per changed case of one record: a line of a line record
// (results/typescript, results/benchmarks, results/dex), or the whole file of a
// file-per-case record (an oracle-count shard, a tests/outcomes outcome.json).
// A row names its kind, its record, its case and the row's key in that record,
// the row before (null where the case had none) and after, and a digest of the
// sources its case was measured from. A line record the recorder created has
// its header line too, for a main that does not have that record yet.
//
// This module is the format alone, so the full check can read a delta without
// loading the recorders; record-pending.ts writes and applies it.

/** The delta's file in a run's folder: where the full check's call (`--after <part> <run>`) leaves it. */
export const DELTA_FILE = "record-pending.delta.json";

export type DeltaRow = {
  /** The recorder kind that wrote it (record-pending.ts's KINDS). */
  kind: string;
  /** The record file, relative to the root. */
  record: string;
  /** The case, as the checks' pending lines name it. */
  case: string;
  /** The row's key in its record: the case, or the case and its scope. */
  key: string;
  /** The row before: its line, or the record's text; null where the case had no row. */
  before: string | null;
  after: string;
  /**
   * A digest of the case's sources where it was measured (record-pending.ts's
   * sourceDigests). A benchmark's compile row is held to the source and driver
   * digests it carries instead.
   */
  sources: string;
};

export type Delta = {
  version: 1;
  /** The commit the rows were recorded at, or null outside a checkout. */
  commit: string | null;
  /** The header line of each line record a row is in, as the recorder left it. */
  headers: Record<string, string>;
  rows: DeltaRow[];
};

export class MalformedDelta extends Error {}

function fail(message: string): never { throw new MalformedDelta(`malformed records delta: ${message}`); }
const isText = (value: unknown): value is string => typeof value === "string";

/** A delta read back, every field checked; a MalformedDelta names what is wrong. */
export function parseDelta(text: string): Delta {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { fail(`not JSON (${error instanceof Error ? error.message : String(error)})`); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("not an object");
  const delta = value as Record<string, unknown>;
  if (delta.version !== 1) fail(`unknown version ${String(delta.version)}`);
  if (delta.commit !== null && !(isText(delta.commit) && /^[0-9a-f]{40,64}$/.test(delta.commit))) fail("its commit is neither a commit nor null");
  const headers = delta.headers;
  if (headers === null || typeof headers !== "object" || Array.isArray(headers) || !Object.values(headers).every(isText)) fail("its headers are not lines by record");
  if (!Array.isArray(delta.rows)) fail("it has no rows");
  const seen = new Set<string>();
  const rows = delta.rows.map((row: unknown, index: number): DeltaRow => {
    const where = `row ${index + 1}`;
    if (row === null || typeof row !== "object" || Array.isArray(row)) fail(`${where} is not an object`);
    const r = row as Record<string, unknown>;
    const names = ["kind", "record", "case", "key", "before", "after", "sources"];
    if (Object.keys(r).sort().join() !== [...names].sort().join()) fail(`${where} has the fields ${Object.keys(r).sort().join(", ")}`);
    for (const name of ["kind", "record", "case", "key", "after", "sources"]) if (!isText(r[name]) || r[name] === "") fail(`${where}: ${name} is not text`);
    if (r.before !== null && !isText(r.before)) fail(`${where}: before is neither text nor null`);
    if (r.before === r.after) fail(`${where}: its row did not change`);
    const id = `${String(r.record)}\0${String(r.key)}`;
    if (seen.has(id)) fail(`${where}: ${String(r.record)} has two rows for ${String(r.case)}`);
    seen.add(id);
    return { kind: r.kind as string, record: r.record as string, case: r.case as string, key: r.key as string, before: r.before as string | null, after: r.after as string, sources: r.sources as string };
  });
  return { version: 1, commit: delta.commit as string | null, headers: headers as Record<string, string>, rows };
}

export function serializeDelta(delta: Delta): string {
  return `${JSON.stringify(delta, null, 2)}\n`;
}

/** What `--apply` did with a delta's rows. */
export type ApplyCounts = { applied: number; already: number; skipped: number };

/** The line `--apply` ends with. */
export function appliedLine(counts: ApplyCounts): string {
  return `record-pending --apply: ${counts.applied} row(s) applied, ${counts.already} already recorded, ${counts.skipped} skipped; nothing is committed`;
}
const APPLIED = /^record-pending --apply: (\d+) row\(s\) applied, (\d+) already recorded, (\d+) skipped;/m;

/** The counts an `--apply` log ends with, or null when it has no such line. */
export function appliedIn(log: string): ApplyCounts | null {
  const found = [...log.matchAll(new RegExp(APPLIED.source, "gm"))].at(-1);
  return found ? { applied: Number(found[1]), already: Number(found[2]), skipped: Number(found[3]) } : null;
}

/** The counts in words, for a log line or a commit message. */
export const countsText = (counts: ApplyCounts): string => `${counts.applied} row(s) applied, ${counts.already} already recorded, ${counts.skipped} skipped`;
