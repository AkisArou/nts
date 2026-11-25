import assert from "node:assert/strict";
import type { Backend } from "./run-record.ts";

export const OWN_BEST_COVERAGE_FLOOR = 0.8;
export type Coverage = { established: number; total: number; verdict: "green" | "red" | "unavailable" };
export type OwnBestCoverage = Record<Backend, Coverage>;
export function coverage(established: number, total: number): Coverage {
  assert.ok(Number.isSafeInteger(established) && Number.isSafeInteger(total) && established >= 0 && total >= established, "invalid own-best coverage counts");
  return { established, total, verdict: total === 0 ? "unavailable" : established / total < OWN_BEST_COVERAGE_FLOOR ? "red" : "green" };
}
export function coverageText(rows: OwnBestCoverage): string {
  return Object.entries(rows).map(([backend, c]) => `${backend} ${c.established}/${c.total} ${c.verdict}`).join("; ");
}
export function coverageHeader(rows: OwnBestCoverage): string {
  return `Own-best coverage (minimum ${OWN_BEST_COVERAGE_FLOOR * 100}%): ${coverageText(rows)}.\n<!-- own-best-coverage ${JSON.stringify(rows)} -->`;
}
/** Read the renderer's structured coverage, never infer green from an empty slower list. */
export function readCoverage(page: string): OwnBestCoverage | null {
  const matches = [...page.matchAll(/^<!-- own-best-coverage (.+) -->$/gm)];
  if (!matches.length) return null;
  assert.equal(matches.length, 1, "duplicate own-best coverage");
  return parseCoverage(JSON.parse(matches[0]![1]!));
}
export function parseCoverage(value: unknown): OwnBestCoverage {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "invalid own-best coverage object");
  const rows = value as OwnBestCoverage;
  assert.deepEqual(Object.keys(rows).sort(), ["nts C", "nts JVM", "nts LLVM"], "unknown own-best coverage backend");
  for (const row of Object.values(rows)) {
    assert.ok(row !== null && typeof row === "object" && !Array.isArray(row), "invalid own-best coverage row");
    assert.deepEqual(row, coverage(row.established, row.total), "invalid own-best coverage verdict");
  }
  return rows;
}
