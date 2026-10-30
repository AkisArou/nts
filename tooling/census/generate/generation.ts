import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GENERATOR_VERSION, isCell } from "./model.ts";
import type { Cell } from "./model.ts";
import { CELLS, generateModel } from "./scenarios.ts";
import { precheckProgram, WASTE_REASONS } from "./precheck.ts";
import type { CheckProgress, WasteReason } from "./precheck.ts";
import { finishManifest, json, writeProgram } from "./writer.ts";

export interface GenerationOptions {
  seed: number;
  count: number;
  cells: readonly Cell[];
  out: string;
  onProgress?: (summary: GenerationSummary) => void;
}
export interface GenerationSummary {
  version: 1;
  generatorVersion: string;
  seed: number;
  requested: number;
  attempted: number;
  written: number;
  passed: Record<keyof CheckProgress, number>;
  waste: Record<WasteReason, number>;
  cells: { cell: Cell; attempted: number; written: number }[];
  rejected: { ordinal: number; cell: Cell; reason: WasteReason; detail: string }[];
}

export function parseCells(text: string): Cell[] {
  if (text === "all") return [...CELLS];
  const cells = text.split(",");
  if (cells.length === 0 || !cells.every(isCell) || new Set(cells).size !== cells.length) {
    throw new Error(`--cells needs distinct entries from ${CELLS.join(",")}`);
  }
  return cells;
}
export function ensureEmptyOutput(directory: string): void {
  mkdirSync(directory, { recursive: true });
  if (readdirSync(directory).length !== 0) throw new Error(`output directory is not empty: ${directory}`);
}

/** --count counts attempts. Invalid/no-op samples are dropped and counted, never replaced silently. */
export function generateBatch(options: GenerationOptions): GenerationSummary {
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffff_ffff) {
    throw new Error("--seed must be an integer in 0..4294967295");
  }
  if (!Number.isSafeInteger(options.count) || options.count < 1) throw new Error("--count must be a positive safe integer");
  if (options.cells.length === 0 || !options.cells.every(isCell) || new Set(options.cells).size !== options.cells.length) {
    throw new Error("choose at least one distinct stage-1 cell");
  }
  const out = resolve(options.out);
  ensureEmptyOutput(out);
  const summary: GenerationSummary = {
    version: 1, generatorVersion: GENERATOR_VERSION, seed: options.seed,
    requested: options.count, attempted: 0, written: 0,
    passed: { strict: 0, deterministic: 0, twins: 0, witness: 0 },
    waste: { typecheck: 0, "node-error": 0, nondeterministic: 0, "twin-mismatch": 0, "no-witness": 0, "invalid-inventory": 0 },
    cells: options.cells.map((cell) => ({ cell, attempted: 0, written: 0 })), rejected: [],
  };
  for (let ordinal = 0; ordinal < options.count; ordinal++) {
    // Balanced selection keeps every requested cell exercised; policy draws have
    // independent seeded streams, so rejected predecessors cannot shift replay.
    const cell = options.cells[ordinal % options.cells.length];
    const cellSummary = summary.cells[ordinal % options.cells.length];
    const name = `${String(ordinal).padStart(6, "0")}-${cell.replace(":", "-")}`;
    const directory = join(out, name);
    const model = generateModel(options.seed, ordinal, cell);
    const { printed } = writeProgram(directory, model);
    const checked = precheckProgram(directory, printed.functions);
    summary.attempted++;
    cellSummary.attempted++;
    for (const key of ["strict", "deterministic", "twins", "witness"] satisfies (keyof CheckProgress)[]) {
      if (checked.passed[key]) summary.passed[key]++;
    }
    if (checked.ok) {
      finishManifest(directory, checked.distinguishingInputs);
      summary.written++;
      cellSummary.written++;
    } else {
      summary.waste[checked.reason]++;
      summary.rejected.push({ ordinal, cell, reason: checked.reason, detail: checked.detail });
      rmSync(directory, { recursive: true, force: true });
    }
    options.onProgress?.(summary);
  }
  writeFileSync(join(out, "summary.json"), json(summary));
  return summary;
}

export function formatSummary(summary: GenerationSummary): string {
  const { passed } = summary;
  return [
    `seed ${summary.seed}: ${summary.written}/${summary.attempted} programs written`,
    `(a) strict ${passed.strict}; (b) repeatable Node ${passed.deterministic}; (c) twins ${passed.twins}; (d) distinguishing input ${passed.witness}`,
    `waste: ${WASTE_REASONS.map((reason) => `${reason}=${summary.waste[reason]}`).join(", ")}`,
    `cells: ${summary.cells.map(({ cell, written, attempted }) => `${cell}=${written}/${attempted}`).join(", ")}`,
  ].join("\n");
}
