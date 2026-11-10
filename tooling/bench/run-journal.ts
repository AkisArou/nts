// A committed line is one finished case. An interrupted last write is never a row.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function readJournal(path: string) {
  const lines = readFileSync(path, "utf8").split("\n");
  lines.pop(); // Only newline-terminated frames were committed by the producer.
  assert.ok(lines.length, "benchmark journal has no committed header");
  const header = JSON.parse(lines.shift()!);
  assert.equal(header.version, 1, "unknown benchmark journal version");
  assert.ok(header.metadata && Array.isArray(header.cases), "invalid benchmark journal header");
  const cases: string[] = header.cases;
  assert.ok(cases.every(name => typeof name === "string") && new Set(cases).size === cases.length, "invalid journal case inventory");
  const raw = { metadata: header.metadata, cases, requested: header.requested, lanes: header.lanes,
    measured: [] as unknown[], conditions: {} as Record<string, unknown>, row_failures: {} as Record<string, unknown>,
    spoiled: [] as string[], failed: [] as string[] };
  let completed = 0;
  for (const line of lines) {
    const frame = JSON.parse(line), name = cases[completed];
    assert.ok(name !== undefined && frame.name === name, "out-of-order benchmark journal row");
    if (frame.measured !== null) {
      assert.equal(frame.measured.shown, name, "journal observation belongs to another case");
      raw.measured.push(frame.measured);
    }
    if (frame.failure !== null) raw.row_failures[name] = frame.failure;
    raw.conditions[name] = frame.conditions;
    if (frame.spoiled) raw.spoiled.push(name);
    assert.ok(Array.isArray(frame.failed) && frame.failed.every((why: unknown) => typeof why === "string"), "invalid journal failures");
    raw.failed.push(...frame.failed);
    completed++;
  }
  return { raw, unreached: cases.slice(completed) };
}
