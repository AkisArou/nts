import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {readBuildDetails} from './build-details.ts';
import { EXECUTABLE_SIZE_KIND, checkExecutableSizeCell } from "./executable-size-cell.ts";
import { LAUNCH_KIND, checkLaunchCell } from "./launch-cell.ts";
import { PEAK_RSS_KIND, checkPeakRssCell, type Sized } from "./peak-rss-cell.ts";
import {
  COMPARATORS,
  sealRun,
  type Cell,
  type Json,
  type Row,
  type RunRecord,
} from "./run-record.ts";

export type Metadata = Omit<RunRecord, "rows">;
type ObjectValue = Record<string, unknown>;
function object(v: unknown): ObjectValue {
  assert.ok(v !== null && typeof v === "object" && !Array.isArray(v), "producer object missing");
  return v as ObjectValue;
}
function values(v: unknown): unknown[] {
  assert.ok(Array.isArray(v), "producer array missing");
  return v;
}
function string(v: unknown): string {
  assert.equal(typeof v, "string");
  return v as string;
}
function clean(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}
function reason(value: unknown, fallback: string): string {
  return value == null ? fallback : typeof value === "string" ? value : JSON.stringify(value);
}
export function absent(
  status: Exclude<Cell["status"], "OK">,
  why: string,
  details: unknown = null,
): Cell {
  return {
    status,
    nanoseconds: null,
    spread: null,
    checksum: null,
    verified: false,
    reason: why,
    details: clean(details),
  };
}
function measured(value: unknown, legacy = false): Cell {
  const o = object(value);
  const ns = o.ns ?? o.ns_per_op,
    spread = o.spread ?? null,
    checksum = o.checksum ?? null;
  assert.ok(typeof ns === "number" && Number.isFinite(ns) && ns > 0, "producer timing malformed");
  return {
    status: "OK",
    nanoseconds: ns,
    spread: spread as number | null,
    checksum: checksum as string | null,
    verified: !legacy && checksum !== null && spread !== null,
    reason: legacy ? "Historical checksum or spread was not retained" : null,
    details: clean(o),
  };
}
/**
 * A launch row's cell as host-columns.ts --launch made it: a launch cell
 * holds its whole protocol (checked again when the run is sealed), and an
 * absent one its reason; a peak-RSS row's cell also its peak RSS, derived
 * from the same launches. Anything else is an instrument error.
 */
function launchCell(value: unknown, at: string, peak: boolean, size = false): Cell {
  const o = object(value);
  assert.deepEqual(Object.keys(o).sort(), ["checksum", "details", ...(size ? ["executableSize"] : []), "nanoseconds", ...(peak ? ["peakRss"] : []), "reason", "spread", "status", "verified"], at + ": malformed launch cell");
  const cell = { ...(o as unknown as Cell), details: clean(o.details) };
  if (size) checkExecutableSizeCell(cell, at);
  else if (peak) checkPeakRssCell(cell, at);
  else if (cell.status === "OK") checkLaunchCell(cell, at);
  if (cell.status !== "OK") assert.ok(cell.nanoseconds === null && cell.spread === null && !cell.verified && typeof cell.reason === "string", at + ": an absent launch cell carries a timing");
  return cell;
}
/** A peak-RSS frame's sized workload, exactly. */
function sized(value: unknown): Sized {
  const o = object(value);
  assert.deepEqual(Object.keys(o).sort(), ["case", "function", "input"], "malformed peak-RSS workload");
  assert.ok(typeof o.case === "string" && typeof o.function === "string" && typeof o.input === "number" && Number.isFinite(o.input), "malformed peak-RSS workload");
  return { case: o.case, function: o.function, input: o.input };
}
export function comparatorCell(value: unknown): Cell {
  const o = object(value),
    status = string(o.status);
  if (status === "OK") return measured(o);
  const statuses: Record<string, Cell["status"]> = {
    REFUSED: "REFUSED",
    ABORT: "ABORTED",
    CRASHED: "ABORTED",
    "NOT PROVIDED": "NOT_PROVIDED",
    "TIMED OUT": "TIMED_OUT",
    MISMATCH: "INVALID",
    "INVALID OUTPUT": "INVALID",
    "INVALID (timing loop)": "INVALID",
    "COMPILE FAILED": "BUILD_FAILED",
    "BUILD FAILED": "BUILD_FAILED",
    "INPUT PROTOCOL FAILED": "INVALID",
  };
  const mapped =
    statuses[status] ??
    (status.startsWith("OVER CPU BUDGET")
      ? "OVER_BUDGET"
      : status.startsWith("NOT TIMED") || status.startsWith("INVALID")
        ? "INVALID"
        : undefined);
  assert.ok(mapped, "unknown comparator producer status: " + status);
  return absent(mapped as Exclude<Cell["status"], "OK">, reason(o.reason, status), o);
}
function row(
  name: string,
  cells: Record<string, Cell>,
  conditions: unknown,
  identity: string | null,
  eligible: boolean,
  peak = false,
  sizeOracle?: Cell,
): Row {
  // A peak-RSS row's cells all say whether they have a peak RSS; an invalidated one has none.
  const invalid = (why: string, c: Cell): Cell => ({ ...absent("INVALID", why, c), ...(peak ? { peakRss: null } : {}), ...(sizeOracle ? { executableSize: null } : {}) });
  if ((sizeOracle ?? cells.node).status !== "OK")
    for (const [column, c] of Object.entries(cells))
      if (c.status === "OK")
        cells[column] = invalid("Node oracle did not complete; timing is unverified", c);
  const answers = new Set(
    [...Object.values(cells), ...(sizeOracle ? [sizeOracle] : [])]
      .filter((c) => c.status === "OK" && c.verified)
      .map((c) => c.checksum),
  );
  if (answers.size > 1)
    for (const [column, c] of Object.entries(cells))
      if (c.status === "OK")
        cells[column] = invalid("Checksum disagreement; row is not timed", c);
  return {
    name,
    workloadIdentity: identity,
    eligibleForBest: eligible && answers.size <= 1,
    conditions: clean(conditions),
    cells,
    verdicts: {} as Row["verdicts"],
  };
}
export function fromComparator(
  meta: Metadata,
  input: unknown,
  identities: Record<string, string | null> = {},
  eligible = false,
): RunRecord {
  const rows = values(input).map((raw) => {
    const r = object(raw),
      name = string(r.name),
      source = object(r.cells);
    const cells = Object.fromEntries(
      meta.columns.map((column) => [
        column,
        Object.hasOwn(source, column)
          ? comparatorCell(source[column])
          : absent("NOT_RUN", "Column was not present in this retained observation"),
      ]),
    );
    return row(
      name,
      cells,
      {
        before: r.before ?? null,
        after: r.after ?? null,
        cpu5: r.cpu5 ?? null,
        retimedColumns: r.retimedColumns ?? null,
      },
      identities[name] ?? null,
      eligible,
    );
  });
  return sealRun({ ...meta, rows });
}

const NATIVE = [
  { column: "nts C", index: 0, key: "nts_c" },
  { column: "nts f64", index: 1, key: "nts_f64" },
  { column: "C++", index: 2, key: "cpp" },
  { column: "nts LLVM", index: 3, key: "nts_llvm" },
  { column: "nts JVM", index: 4, key: "nts_jvm" },
  { column: "Java", index: 5, key: "java" },
];
export function fromNts(
  meta: Metadata,
  input: unknown,
  identities: Record<string, string | null> = {},
  hosts: Record<string, Record<string, Cell>> = {},
): RunRecord {
  const raw = object(input),
    measurements = values(raw.measured),
    byName = new Map<string, ObjectValue>();
  const lanes = raw.lanes === null ? null : values(raw.lanes).map(string);
  for (const value of measurements) {
    const m = object(value),
      name = string(m.shown);
    assert.ok(!byName.has(name), "duplicate nts producer row");
    byName.set(name, m);
  }
  const caseNames = values(raw.cases).map(string);
  assert.equal(new Set(caseNames).size, caseNames.length, "duplicate requested case");
  for (const name of byName.keys())
    assert.ok(caseNames.includes(name), "orphan native observation: " + name);
  const rows = values(raw.cases).map((value) => {
    const name = string(value),
      m = byName.get(name);
    const valueFailure = object(raw.row_failures ?? {})[name];
    const failure = valueFailure === undefined ? null : object(valueFailure);
    if (failure)
      assert.ok(
        ["build_failed", "invalid"].includes(string(failure.kind)),
        "unknown typed row failure",
      );
    const cells = Object.fromEntries(
      meta.columns.map((c) => [
        c,
        absent(
          failure?.kind === "build_failed" ? "BUILD_FAILED" : "NOT_RUN",
          failure ? string(failure.reason) :
            values(object(raw.session ?? {}).unreached ?? []).includes(name)
              ? "Session time budget exhausted before this case completed"
              : "No measurement was returned for this column",
          failure ? clean(failure) : (raw.failed ?? null),
        ),
      ]),
    );
    // The frame's own JSON text, which no other parser has rounded (main.rs's Measurements.launch).
    const launch = m?.launch === undefined || m?.launch === null ? null : object(JSON.parse(string(m.launch)));
    const peak = launch?.kind === PEAK_RSS_KIND, size = launch?.kind === EXECUTABLE_SIZE_KIND;
    const sizeOracle = size ? launchCell(launch!.oracle, name + "/oracle", false) : undefined;
    if (launch) {
      assert.ok(launch.kind === LAUNCH_KIND || peak || size, "unknown launch row kind");
      assert.deepEqual(Object.keys(launch).sort(), ["cells", "floor", "kind", ...(size ? ["oracle"] : []), "provenance", ...(peak ? ["sized"] : [])], `launch row ${name}: malformed frame`);
      // Every launch row was built and timed at the run's own commit.
      assert.equal(object(launch.provenance).commit, meta.sourceCommit, `launch row ${name} was measured at another commit than its run`);
      const launchCells = object(launch.cells);
      for (const column of meta.columns) {
        assert.ok(Object.hasOwn(launchCells, column), "launch row omits column " + column);
        cells[column] = launchCell(launchCells[column], name + "/" + column, peak, size);
      }
    } else if (m) {
      const measuredCells = values(m.results),
        absences = object(m.absences),
        outcomes = object(absences.outcomes ?? {});
      assert.equal(measuredCells.length, 6, "unknown native column inventory");
      for (const { column, index, key } of NATIVE) {
        if (!meta.columns.includes(column)) continue;
        const lane =
          column === "nts C"
            ? "c"
            : column === "nts f64"
              ? "f64"
              : column === "nts LLVM"
                ? "llvm"
                : column === "nts JVM" || column === "Java"
                  ? "jvm"
                  : "cpp";
        if (lanes !== null && !lanes.includes(lane)) {
          cells[column] = absent("NOT_RUN", "Lane was not requested");
          continue;
        }
        if (measuredCells[index] !== null) cells[column] = measured(measuredCells[index]);
        else if (Object.hasOwn(outcomes, key))
          cells[column] = absent(
            "ABORTED",
            reason(object(outcomes[key]).stderr, "Native runtime terminated without a checksum"),
            outcomes[key],
          );
        else if (column === "nts JVM" && ["NoDriver", "NotRun"].includes(absences.jvm as string))
          cells[column] = absent(
            "NOT_RUN",
            absences.jvm === "NoDriver"
              ? "Program emitted, but the harness cannot drive its entry"
              : "Lane was not requested",
          );
        else if (
          column === "nts C" ||
          column === "nts LLVM" ||
          column === "nts JVM" ||
          column === "nts f64"
        )
          cells[column] = absent(
            "REFUSED",
            "Compiled binding was unavailable",
            column === "nts JVM" ? absences.jvm : null,
          );
        else
          cells[column] = absent(
            "NOT_PROVIDED",
            reason(column === "C++" ? absences.cpp : column === "Java" ? absences.java : null, "Reference was unavailable"),
            column === "C++" ? absences.cpp : column === "Java" ? absences.java : null,
          );
      }
      if (m.node !== null) cells.node = measured(m.node);
      if (m.bun !== null && m.bun !== undefined) cells["Bun JIT"] = measured(m.bun);
    }
    for (const [column, value] of Object.entries(launch ? {} : hosts[name] ?? {})) {
      assert.ok(
        COMPARATORS.includes(column as (typeof COMPARATORS)[number]),
        "unknown host column",
      );
      cells[column] = value;
    }
    if (failure?.kind === "invalid")
      for (const [column, c] of Object.entries(cells))
        if (c.status === "OK") cells[column] = { ...absent("INVALID", string(failure.reason), c), ...(peak ? { peakRss: null } : {}), ...(size ? { executableSize: null } : {}) };
    const result=row(
      name,
      cells,
      {
        spoiled: values(raw.spoiled).includes(name),
        machine: object(raw.conditions ?? {})[name] ?? null,
        sourceCapture: m?.source_capture ?? null,
        hostProvenance: object(m?.hosts ?? {}).provenance ?? null,
        ...(sizeOracle ? { sizeOracle: clean(sizeOracle) } : {}),
        ...(launch ? { launchFloor: clean(launch.floor), launchProvenance: clean(launch.provenance) } : {}),
      },
      identities[name] ?? workloadIdentity(m?.source_capture, m?.workload),
      Boolean(identities[name] ?? m?.source_capture) && !values(raw.spoiled).includes(name),
      peak, sizeOracle,
    );
    if (launch && peak) Object.assign(result, { kind: PEAK_RSS_KIND, sized: sized(launch.sized) });
    else if (size) result.kind = EXECUTABLE_SIZE_KIND;
    else if (launch) result.kind = LAUNCH_KIND;
    const builds=object(raw.builds??{})[name];
    if(builds!==undefined)result.builds=readBuildDetails(builds);
    return result;
  });
  return sealRun({ ...meta, rows });
}

/** Identity supplied by the exact compiler capture; never resolve or reread a source here. */
export function workloadIdentity(capture: unknown, input: unknown): string | null {
  if (capture === null || capture === undefined) return null;
  const c = object(capture);
  assert.equal(c.algorithm, "xxh3-128-le-checked-utf8-v1");
  const files = values(c.workload)
    .map((raw) => {
      const f = object(raw),
        path = string(f.path),
        digest = string(f.digest);
      assert.match(digest, /^[a-f0-9]{32}$/);
      return { path, digest, rewrittenBy: f.rewritten_by ?? null };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  assert.ok(
    files.length > 0 && new Set(files.map((f) => f.path)).size === files.length,
    "empty or duplicate captured workload",
  );
  const exact = JSON.stringify(input, (_, v) => {
    if (typeof v !== "number") return v;
    const bits = Buffer.alloc(8);
    bits.writeDoubleBE(v);
    return { float64Bits: bits.toString("hex") };
  });
  return createHash("sha256")
    .update(
      JSON.stringify({ algorithm: c.algorithm, files, input: exact, drivers: c.drivers ?? [] }),
    )
    .digest("hex");
}
