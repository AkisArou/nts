/** One-way historical import. Unknown measurements stay unknown; this is not a runtime reader. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { COLUMNS, sealRun, type Cell, type Row, type RunRecord } from "./run-record.ts";
import { absent, type Metadata } from "./run-producers.ts";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function legacy(ns: number, details: unknown): Cell {
  return {
    status: "OK",
    nanoseconds: ns,
    spread: null,
    checksum: null,
    verified: false,
    reason: "Historical checksum and spread were not retained",
    details: JSON.parse(JSON.stringify(details)),
  };
}
const labels: Record<string, string> = {
  "nts (C)": "nts C",
  "nts (LLVM)": "nts LLVM",
  "nts (JVM)": "nts JVM",
  V8: "node",
  Bun: "Bun JIT",
  "nts (Wasm)": "nts Wasm",
  "C++ (wasm)": "C++ Wasm",
  AssemblyScript: "AssemblyScript",
  "C++": "C++",
  Java: "Java",
};
function blank(columns: readonly string[]): Record<string, Cell> {
  return Object.fromEntries(
    columns.map((c) => [
      c,
      absent("NOT_PROVIDED", "Column was not provided in this historical run"),
    ]),
  );
}
function row(name: string, cells: Record<string, Cell>): Row {
  return {
    name,
    workloadIdentity: null,
    eligibleForBest: false,
    conditions: null,
    cells,
    verdicts: {} as Row["verdicts"],
  };
}
export function importFull(meta: Metadata, source: string): RunRecord {
  const all = source.split("\n"),
    start = all.findIndex((l) => /^\| case \|/.test(l));
  assert.ok(start >= 0, "missing historical table");
  const lines: string[] = [];
  for (const l of all.slice(start)) {
    if (!l.startsWith("|")) break;
    lines.push(l);
  }
  const header = lines
    .shift()
    ?.split("|")
    .slice(1, -1)
    .map((s) => s.trim());
  assert.ok(header && header[0] === "case", "missing historical table header");
  const columns = [
    ...COLUMNS,
    ...header
      .filter((h) => labels[h] && !COLUMNS.includes(labels[h] as (typeof COLUMNS)[number]))
      .map((h) => labels[h]),
  ];
  const rows = lines
    .filter((l) => !/^\|[\s:|-]+\|$/.test(l))
    .map((line) => {
      const fields = line
        .split("|")
        .slice(1, -1)
        .map((s) => s.trim());
      assert.equal(fields.length, header.length, "historical row field count");
      const cells = blank(columns);
      header.forEach((label, i) => {
        const column = labels[label];
        if (!column) return;
        const text = fields[i]
          .replaceAll("**", "")
          .replace(/[†‡▲]/g, "")
          .trim();
        if (text === "--") return;
        const m = /^(\d+(?:\.\d+)?) (ns|us|µs|ms)$/.exec(text);
        assert.ok(m, "unknown historical timing: " + text);
        cells[column] = legacy(Number(m[1]) * { ns: 1, us: 1000, µs: 1000, ms: 1e6 }[m[2]]!, {
          original: fields[i],
        });
      });
      return row(fields[0].replace(/ \(rc\)$/, ""), cells);
    });
  return sealRun({
    ...meta,
    inventory: rows.map((r) => r.name),
    columns,
    harness: {
      identity: "legacy-report-artifact-sha256:" + hash(source),
      contract: null,
      files: [{ path: "historical/full.md", sha256: hash(source) }],
    },
    provenance: {
      kind: "historical rendered table",
      original: source,
      missing: [
        "executable harness identity",
        "checksums",
        "spreads",
        "precise run timestamps",
        "workload capture",
        "machine conditions",
      ],
    },
    rows,
  });
}
export function importCells(
  meta: Metadata,
  source: string,
  commitPrefix: string,
  inventory: string[],
  log: string,
): RunRecord {
  const lines = source.replace(/\n$/, "").split("\n"),
    header = lines.shift();
  assert.equal(header, "case\tcolumn\tns_per_call\tmeasured\tcommit\tnote");
  const names: Record<string, string> = {
    nts_c: "nts C",
    nts_llvm: "nts LLVM",
    nts_jvm: "nts JVM",
    nts_f64: "nts f64",
    cpp: "C++",
    java: "Java",
    node: "node",
    bun: "Bun JIT",
  };
  const columns = [...COLUMNS, "nts f64"],
    rows = inventory.map((name) => row(name, blank(columns))),
    byName = new Map(rows.map((r) => [r.name, r])),
    seen = new Set<string>();
  let imported = 0;
  for (const line of lines) {
    const fields = line.split("\t");
    assert.equal(fields.length, 6, "historical cells field count");
    const [name, key, value, measured, commit, note] = fields;
    if (!commit.startsWith(commitPrefix)) continue;
    const column = names[key];
    assert.ok(column, "unknown legacy column " + key);
    assert.ok(!seen.has(name + "/" + column), "duplicate historical cell");
    seen.add(name + "/" + column);
    const target = byName.get(name);
    assert.ok(target, "historical cell is outside declared inventory: " + name);
    target.cells[column] =
      value === "refused"
        ? absent("REFUSED", note || "Historical compile refusal", { measured, commit })
        : legacy(Number(value), { measured, commit, note });
    assert.ok(
      value === "refused" || (Number.isFinite(Number(value)) && Number(value) > 0),
      "invalid historical timing",
    );
    imported++;
  }
  assert.ok(imported > 0, "no cells for the requested historical commit");
  // A failed row is not supplied by an older cell left in the rolling file.
  for (const r of rows)
    if (!Object.values(r.cells).some((c) => c.status === "OK" || c.status === "REFUSED"))
      for (const c of columns)
        r.cells[c] = absent(
          "INVALID",
          "Historical run rejected this row; no accepted timing was retained",
          { log: log.split("\n").filter((l) => l.includes(r.name)) },
        );
  return sealRun({
    ...meta,
    inventory,
    columns,
    harness: {
      identity: "legacy-report-artifact-sha256:" + hash(source + log),
      contract: null,
      files: [
        { path: "historical/cells.tsv", sha256: hash(source) },
        { path: "historical/bench-run.log", sha256: hash(log) },
      ],
    },
    provenance: {
      kind: "historical rolling file filtered by each cell's compiler commit",
      originalDigest: hash(source),
      log,
      missing: [
        "executable harness identity",
        "checksums",
        "spreads",
        "workload capture",
        "precise per-row machine conditions",
      ],
    },
    rows,
  });
}
