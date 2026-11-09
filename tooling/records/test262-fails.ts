// The test262 fail rows a records run added, said aloud (docs/workflow.md,
// Records). A case that runs now and fails is recorded as pending, with what
// it threw, because test262's record holds only the cases that ran and cannot
// tell "refused before" from "never ran". But in nts a case going from refused
// to failing can be a soundness loss: the compiler now accepts code it gets
// wrong, where it used to refuse it. So the full check names every such row in
// a task line (tooling/full-check/service.ts), by record and directory, with
// the full list beside its run, for the coordinator to make tracked defects of.
import { writeFileSync } from "node:fs";
import { parseTest262Row } from "../census/test262-record.ts";
import type { Delta } from "./delta.ts";

/** One fail row a delta adds: its record, its case, and what it threw. */
export interface NewFail { record: string; path: string; detail: string }

/** The fail rows a delta adds to test262's records: cases with no row before that run now and fail. */
export function newTest262Fails(delta: Delta): NewFail[] {
  return delta.rows.filter(row => row.kind === "test262" && row.before === null)
    .map(row => ({ record: row.record, row: parseTest262Row(row.after) }))
    .filter(({ row }) => row.outcome === "fail")
    .map(({ record, row }) => ({ record, path: row.path, detail: row.detail }));
}

/** The directory a case is counted under: its first three path parts (test/language/expressions, test/built-ins/Array), or its own directory when it is shallower. */
export function test262Directory(path: string): string {
  const parts = path.split("/");
  return parts.slice(0, Math.min(3, parts.length - 1)).join("/");
}

const byName = <T>(entries: Iterable<[string, T]>) => [...entries].sort(([a], [b]) => a.localeCompare(b));

/** The task line for these rows, per record and per directory, naming where their full list is; null when there are none. */
export function newTest262FailsTask(fails: readonly NewFail[], commit: string, list: string): string | null {
  if (fails.length === 0) return null;
  const records = byName(Map.groupBy(fails, one => one.record)).map(([record, rows]) =>
    `${record}: ${byName(Map.groupBy(rows, one => test262Directory(one.path))).map(([directory, these]) => `${directory} ${these.length}`).join(", ")}`);
  return `- test262 records at ${commit.slice(0, 12)} added ${fails.length} fail row(s), cases that run now and fail, any of which may be a refusal turned wrong: ${records.join("; ")}. The full list is ${list}.`;
}

/** The full list beside the run: one row per line, record, case and what it threw. */
export function writeNewFails(fails: readonly NewFail[], file: string): void {
  writeFileSync(file, fails.map(one => `${one.record}\t${one.path}\t${one.detail}`).join("\n") + "\n");
}
