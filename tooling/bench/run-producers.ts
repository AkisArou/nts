import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
): Row {
  if (cells.node.status !== "OK")
    for (const [column, c] of Object.entries(cells))
      if (c.status === "OK")
        cells[column] = absent("INVALID", "Node oracle did not complete; timing is unverified", c);
  const answers = new Set(
    Object.values(cells)
      .filter((c) => c.status === "OK" && c.verified)
      .map((c) => c.checksum),
  );
  if (answers.size > 1)
    for (const [column, c] of Object.entries(cells))
      if (c.status === "OK")
        cells[column] = absent("INVALID", "Checksum disagreement; row is not timed", c);
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
          failure ? string(failure.reason) : "No measurement was returned for this column",
          failure ? clean(failure) : (raw.failed ?? null),
        ),
      ]),
    );
    if (m) {
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
            reason(column === "C++" ? absences.cpp : null, "Reference was unavailable"),
            column === "C++" ? absences.cpp : null,
          );
      }
      if (m.node !== null) cells.node = measured(m.node);
      if (m.bun !== null && m.bun !== undefined) cells["Bun JIT"] = measured(m.bun);
    }
    for (const [column, value] of Object.entries(hosts[name] ?? {})) {
      assert.ok(
        COMPARATORS.includes(column as (typeof COMPARATORS)[number]),
        "unknown host column",
      );
      cells[column] = value;
    }
    if (failure?.kind === "invalid")
      for (const [column, c] of Object.entries(cells))
        if (c.status === "OK") cells[column] = absent("INVALID", string(failure.reason), c);
    return row(
      name,
      cells,
      {
        spoiled: values(raw.spoiled).includes(name),
        machine: object(raw.conditions ?? {})[name] ?? null,
        sourceCapture: m?.source_capture ?? null,
        hostProvenance: object(m?.hosts ?? {}).provenance ?? null,
      },
      identities[name] ?? workloadIdentity(m?.source_capture, m?.workload),
      Boolean(identities[name] ?? m?.source_capture) && !values(raw.spoiled).includes(name),
    );
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
