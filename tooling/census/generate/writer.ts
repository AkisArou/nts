import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATOR_VERSION, validateModel } from "./model.ts";
import type { FunctionSpec, PrintedProgram, ProgramModel } from "./model.ts";
import type { DistinguishingInput } from "./precheck.ts";
import { printProgram } from "./printer.ts";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export interface Manifest {
  version: 1;
  generatorVersion: string;
  seed: number;
  ordinal: number;
  cell: ProgramModel["cell"];
  template: ProgramModel["template"];
  model: ProgramModel;
  functions: FunctionSpec[];
  sourcePhase: "model" | "text";
  sourceHash: string;
  /** Observed by Node; expected answers are never embedded in the program. */
  distinguishingInputs: DistinguishingInput[];
}
export interface WrittenProgram {
  model: ProgramModel;
  source: string;
  printed: PrintedProgram;
  manifest: Manifest;
}
export function json(value: unknown): string { return JSON.stringify(value, null, 2) + "\n"; }
export function sourceHash(source: string): string { return createHash("sha256").update(source).digest("hex"); }

/** Only call on a new output directory or a caller-owned reduction workspace. */
export function writeProgram(directory: string, input: ProgramModel,
  options: { source?: string; distinguishingInputs?: DistinguishingInput[] } = {}): WrittenProgram {
  const model = validateModel(input);
  const printed = printProgram(model);
  const source = options.source ?? printed.source;
  if (!source.startsWith("// run: check\n")) throw new Error("a generated entry must start with // run: check");
  const manifest: Manifest = {
    version: 1, generatorVersion: GENERATOR_VERSION, seed: model.seed, ordinal: model.ordinal,
    cell: model.cell, template: model.template, model, functions: printed.functions,
    sourcePhase: source === printed.source ? "model" : "text", sourceHash: sourceHash(source),
    distinguishingInputs: options.distinguishingInputs ?? [],
  };
  mkdirSync(join(directory, "src"), { recursive: true });
  writeFileSync(join(directory, "src", "main.ts"), source);
  writeFileSync(join(directory, "tsconfig.json"), json({
    extends: resolve(ROOT, "tsconfig.fixtures.json"), compilerOptions: { strict: true }, include: ["src"],
  }));
  // nts resolves the sidecar from the entry file, not from tsconfig.json.
  // Keep the root copy requested by the handoff and the consumed copy identical.
  for (const path of [join(directory, "main.domains.json"), join(directory, "src", "main.domains.json")]) {
    if (printed.domains) writeFileSync(path, json(printed.domains));
    else rmSync(path, { force: true });
  }
  writeFileSync(join(directory, "manifest.json"), json(manifest));
  return { model, source, printed, manifest };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Reconstruct metadata from its validated model rather than trusting arbitrary export claims. */
export function readProgram(directory: string): WrittenProgram {
  const raw: unknown = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  if (!record(raw) || raw.version !== 1 || raw.generatorVersion !== GENERATOR_VERSION) {
    throw new Error(`the reducer requires a version-1 manifest from generator ${GENERATOR_VERSION}`);
  }
  const model = validateModel(raw.model);
  const printed = printProgram(model);
  if (raw.cell !== model.cell || raw.template !== model.template || raw.seed !== model.seed || raw.ordinal !== model.ordinal
    || JSON.stringify(raw.functions) !== JSON.stringify(printed.functions)) {
    throw new Error("manifest identity or function inventory does not match its model");
  }
  const source = readFileSync(join(directory, "src", "main.ts"), "utf8");
  if (!source.startsWith("// run: check\n")) throw new Error("the entry is missing // run: check");
  // A maintainer may have edited the real failing file. Keep that text, and start
  // at the text phase when it no longer matches the model; never reconstruct it.
  const manifest: Manifest = {
    version: 1, generatorVersion: GENERATOR_VERSION, seed: model.seed, ordinal: model.ordinal,
    cell: model.cell, template: model.template, model, functions: printed.functions,
    sourcePhase: source === printed.source ? "model" : "text", sourceHash: sourceHash(source), distinguishingInputs: [],
  };
  return { model, source, printed, manifest };
}

export function finishManifest(directory: string, distinguishingInputs: DistinguishingInput[]): void {
  const { manifest } = readProgram(directory);
  manifest.distinguishingInputs = distinguishingInputs;
  writeFileSync(join(directory, "manifest.json"), json(manifest));
}
