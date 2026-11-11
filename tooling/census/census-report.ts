// The census report: the totals of one whole run of one test262 directory on
// one backend, every selected case counted once. conformance262.ts --report
// writes it; the full check's census steps (all.sh's test262_census) keep one
// per backend and directory in their run's folder, and the conformance summary
// (tooling/records/summary.ts) reads those of the last green wide run. This is
// the one place a report is written and read.
//
// A record (test262-record.ts) holds the cases that ran, the ratchet the gate
// holds; a report holds the whole selection, the cases that ran beside the
// ones refused, not attempted or left without a verdict. It is a measurement,
// not a floor: its counts move with every compiler change, and its no-verdict
// count with the machine's load, so nothing holds a run to one.
//
//   { version, under, backend, pin, compiler, commit, harness, degraded,
//     selected, cases, attempted, outcomes, inScope: { cases, pass },
//     excluded, negativesAccepted, notAttempted, refused }
//
// selected is the directory's selection; cases is the part this backend runs,
// which off C leaves out the parse and resolution negatives the frontend
// judges (project.ts, populationOf); outcomes divides the cases five ways
// (docs/conformance/test262.md, Outcomes). notAttempted divides the
// unsupported cases by the harness cause that kept each from running, and
// refused divides the refused ones by the family of their first root.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CENSUS_REPORT_VERSION = 1;
/** Where a run's reports are, under its folder: one per backend and directory. */
export const CENSUS_REPORTS = "test262-census";
export const CENSUS_OUTCOMES = ["pass", "fail", "refused", "unsupported", "no-verdict"] as const;
export type CensusOutcome = typeof CENSUS_OUTCOMES[number];

export interface CensusReport {
  version: typeof CENSUS_REPORT_VERSION;
  /** The directory, as the census's --under names it: `test/language`. */
  under: string;
  backend: string;
  /** The test262 checkout's commit. */
  pin: string;
  /** The compiler's fingerprint, and its commit when it is a clean pin of one. */
  compiler: string;
  commit: string | null;
  harness: string;
  /** The run saw swap traffic or little free memory (conformance262.ts, DEGRADED MACHINE): its no-verdict count may hold timeouts the load caused. */
  degraded: boolean;
  selected: number;
  cases: number;
  attempted: number;
  outcomes: Record<CensusOutcome, number>;
  inScope: { cases: number; pass: number };
  excluded: number;
  negativesAccepted: number;
  notAttempted: Record<string, number>;
  refused: Record<string, number>;
}

/** A run's report of one directory on one backend, by its record's slice name (`language`). */
export const censusReportPath = (run: string, backend: string, slice: string): string => join(run, CENSUS_REPORTS, backend, `${slice}.json`);

const sum = (counts: Readonly<Record<string, number>>) => Object.values(counts).reduce((total, n) => total + n, 0);
/** Counts in a fixed order: the largest first, then by name, so one run's report has one text. */
const ordered = (counts: Readonly<Record<string, number>>) =>
  Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0).sort(([a, m], [b, n]) => n - m || a.localeCompare(b)));

/** The report, checked: its parts must add up as the census's own reconciliation says. */
function checked(report: CensusReport, where: string): CensusReport {
  const fail = (what: string): never => assert.fail(`${where}: ${what}`);
  if (report.version !== CENSUS_REPORT_VERSION) fail(`version ${String(report.version)}, not ${CENSUS_REPORT_VERSION}`);
  for (const key of ["under", "backend", "pin", "compiler", "harness"] as const) if (typeof report[key] !== "string" || report[key] === "") fail(`no ${key}`);
  if (report.commit !== null && !/^[0-9a-f]{40}$/.test(report.commit)) fail(`commit ${String(report.commit)} is not a commit`);
  if (typeof report.degraded !== "boolean") fail("degraded is not a boolean");
  for (const key of ["outcomes", "inScope", "notAttempted", "refused"] as const) {
    const part: unknown = report[key];
    if (part === null || typeof part !== "object" || Array.isArray(part)) fail(`no ${key}`);
  }
  const counts: [string, unknown][] = [["selected", report.selected], ["cases", report.cases], ["attempted", report.attempted],
    ["excluded", report.excluded], ["negativesAccepted", report.negativesAccepted], ["inScope.cases", report.inScope?.cases], ["inScope.pass", report.inScope?.pass],
    ...CENSUS_OUTCOMES.map((o): [string, unknown] => [`outcomes.${o}`, report.outcomes?.[o]]),
    ...Object.entries(report.notAttempted ?? {}).map(([cause, n]): [string, unknown] => [`notAttempted ${cause}`, n]),
    ...Object.entries(report.refused ?? {}).map(([family, n]): [string, unknown] => [`refused ${family}`, n])];
  for (const [name, n] of counts) if (!Number.isSafeInteger(n) || (n as number) < 0) fail(`${name} is not a count`);
  if (Object.keys(report.outcomes).length !== CENSUS_OUTCOMES.length) fail(`outcomes are not ${CENSUS_OUTCOMES.join(", ")}`);
  if (sum(report.outcomes) !== report.cases) fail(`the outcomes sum to ${sum(report.outcomes)}, not its ${report.cases} case(s)`);
  if (report.cases > report.selected) fail(`${report.cases} case(s) of a selection of ${report.selected}`);
  if (report.attempted > report.cases) fail(`${report.attempted} attempted of ${report.cases} case(s)`);
  if (report.inScope.cases + report.excluded !== report.cases) fail(`${report.inScope.cases} in scope and ${report.excluded} excluded are not its ${report.cases} case(s)`);
  if (report.inScope.pass > report.outcomes.pass) fail(`${report.inScope.pass} in-scope passes of ${report.outcomes.pass}`);
  if (sum(report.notAttempted) !== report.outcomes.unsupported) fail(`the causes not attempted sum to ${sum(report.notAttempted)}, not its ${report.outcomes.unsupported} unsupported`);
  if (sum(report.refused) !== report.outcomes.refused) fail(`the refused families sum to ${sum(report.refused)}, not its ${report.outcomes.refused} refused`);
  return report;
}

export function serializeCensusReport(report: CensusReport): string {
  const r = checked(report, `the report of ${report.under} on ${report.backend}`);
  return JSON.stringify({
    version: r.version, under: r.under, backend: r.backend, pin: r.pin, compiler: r.compiler, commit: r.commit, harness: r.harness, degraded: r.degraded,
    selected: r.selected, cases: r.cases, attempted: r.attempted,
    outcomes: Object.fromEntries(CENSUS_OUTCOMES.map(o => [o, r.outcomes[o]])),
    inScope: { cases: r.inScope.cases, pass: r.inScope.pass }, excluded: r.excluded, negativesAccepted: r.negativesAccepted,
    notAttempted: ordered(r.notAttempted), refused: ordered(r.refused),
  }, null, 2) + "\n";
}

/** A report written to `file`, its folder made. */
export function writeCensusReport(file: string, report: CensusReport): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeCensusReport(report));
}

/** A report read back, every part checked; `where` names it in what fails. */
export function parseCensusReport(text: string, where = "a census report"): CensusReport {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { assert.fail(`${where}: not JSON (${(error as Error).message})`); }
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${where}: not an object`);
  return checked(value as CensusReport, where);
}
