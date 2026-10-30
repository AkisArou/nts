import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FunctionSpec, NumberValue } from "./model.ts";
import type { Observation, ObservedValue } from "./node-worker.ts";

export const WASTE_REASONS = ["typecheck", "node-error", "nondeterministic", "twin-mismatch", "no-witness", "invalid-inventory"] as const;
export type WasteReason = typeof WASTE_REASONS[number];
export interface CheckProgress { strict: boolean; deterministic: boolean; twins: boolean; witness: boolean; }
export interface DistinguishingInput {
  subject: string;
  control: string;
  /** Arguments supplied to the actual exports. */
  arguments: NumberValue[];
  /** A literal input inside a no-argument aggregate, when applicable. */
  scenarioInput?: NumberValue[];
}
export type PrecheckResult =
  | { ok: true; passed: CheckProgress; observations: Observation[]; distinguishingInputs: DistinguishingInput[] }
  | { ok: false; passed: CheckProgress; reason: WasteReason; detail: string };

const require = createRequire(import.meta.url);
const WORKER = fileURLToPath(new URL("./node-worker.ts", import.meta.url));

/** Use this checkout's locked compiler; never a PATH/global TypeScript. */
export function typecheck(directory: string): { ok: boolean; detail: string } {
  const compiler = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  if (!existsSync(compiler)) throw new Error("repository TypeScript is missing; run pnpm install");
  const result = spawnSync(process.execPath,
    [compiler, "--project", join(directory, "tsconfig.json"), "--strict", "--noEmit", "--pretty", "false"],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return { ok: result.status === 0 && !result.error,
    detail: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`.trim().replaceAll(directory, "<program>") };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function observed(value: unknown): value is ObservedValue {
  if (!record(value)) return false;
  if (value.kind === "undefined" || value.kind === "null") return true;
  if (value.kind === "string") return typeof value.value === "string";
  if (value.kind === "boolean") return typeof value.value === "boolean";
  return value.kind === "number" && (typeof value.value === "number" && Number.isFinite(value.value)
    || ["NaN", "-0", "Infinity", "-Infinity"].some((item) => item === value.value));
}
function parseRuns(text: string, functions: FunctionSpec[]): Observation[][] {
  const value: unknown = JSON.parse(text);
  if (!record(value) || value.version !== 1 || !Array.isArray(value.runs) || value.runs.length !== 2) {
    throw new Error("invalid Node worker response");
  }
  const runs: Observation[][] = [];
  for (const run of value.runs) {
    if (!Array.isArray(run) || run.length !== functions.length) throw new Error("incomplete Node run");
    const observations: Observation[] = [];
    for (let index = 0; index < functions.length; index++) {
      const item: unknown = run[index];
      const spec = functions[index];
      if (!record(item) || item.name !== spec.name || JSON.stringify(item.inputs) !== JSON.stringify(spec.inputs)
        || !Array.isArray(item.values) || item.values.length !== spec.inputs.length || !item.values.every(observed)) {
        throw new Error(`incomplete Node observation for ${spec.name}`);
      }
      observations.push({ name: spec.name, inputs: spec.inputs, values: item.values });
    }
    runs.push(observations);
  }
  return runs;
}
function runNode(directory: string, functions: FunctionSpec[]): { ok: true; runs: Observation[][] } | { ok: false; detail: string } {
  const run = spawnSync(process.execPath, ["--no-warnings", WORKER, join(directory, "src", "main.ts")],
    { encoding: "utf8", input: JSON.stringify(functions), timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
  if (run.status !== 0 || run.error) {
    return { ok: false, detail: `${run.stderr ?? ""}${run.error?.message ?? ""}`.trim().replaceAll(directory, "<program>") || `node exited ${run.status}` };
  }
  try { return { ok: true, runs: parseRuns(run.stdout, functions) }; }
  catch (error) { return { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

/** Check (a)–(d), including every export and the module-control observation. No nts is run. */
export function precheckProgram(directory: string, functions: FunctionSpec[]): PrecheckResult {
  const passed: CheckProgress = { strict: false, deterministic: false, twins: false, witness: false };
  const reject = (reason: WasteReason, detail: string): PrecheckResult => ({ ok: false, passed, reason, detail });
  const names = new Set(functions.map((fn) => fn.name));
  if (names.size !== functions.length || !functions.some((fn) => fn.role === "subject")
    || !functions.some((fn) => fn.role === "control") || functions.some((fn) => fn.inputs.length === 0
      || fn.inputs.some((input) => input.length !== fn.parameters.length)
      || fn.counterpart !== undefined && !names.has(fn.counterpart))) {
    return reject("invalid-inventory", "exports need unique names, inputs, subjects, controls and valid counterparts");
  }
  const checked = typecheck(directory);
  if (!checked.ok) return reject("typecheck", checked.detail);
  passed.strict = true;
  const first = runNode(directory, functions);
  if (!first.ok) return reject("node-error", first.detail);
  const second = runNode(directory, functions);
  if (!second.ok) return reject("node-error", second.detail);
  const observations = first.runs[0];
  if (!first.runs.concat(second.runs).every((run) => same(run, observations))) {
    return reject("nondeterministic", "the same calls differ across repeated calls or fresh Node processes");
  }
  passed.deterministic = true;
  const byName = new Map(observations.map((item) => [item.name, item]));
  for (const spec of functions.filter((fn) => fn.role === "twin")) {
    const twin = byName.get(spec.name);
    const original = byName.get(spec.counterpart ?? "");
    if (!twin || !original || !same(twin.inputs, original.inputs) || !same(twin.values, original.values)) {
      return reject("twin-mismatch", `${spec.name} does not agree with ${spec.counterpart ?? "its missing counterpart"}`);
    }
  }
  passed.twins = true;
  const distinguishingInputs: DistinguishingInput[] = [];
  for (const spec of functions.filter((fn) => fn.role === "subject")) {
    const subject = byName.get(spec.name);
    const control = byName.get(spec.counterpart ?? "");
    const controlSpec = functions.find((fn) => fn.name === spec.counterpart);
    if (!subject || !control || controlSpec?.role !== "control" || !same(subject.inputs, control.inputs)) {
      return reject("invalid-inventory", `${spec.name} needs an effect-removed control with the same inputs`);
    }
    const before = distinguishingInputs.length;
    for (let i = 0; i < subject.values.length; i++) {
      if (!same(subject.values[i], control.values[i])) {
        const witness: DistinguishingInput = { subject: spec.name, control: control.name, arguments: subject.inputs[i] };
        // The printer's aggregate encoding preserves each internal literal input.
        if (spec.observationEncoding === "number-list-v1" && spec.scenarioInputs) {
          const left = subject.values[i], right = control.values[i];
          if (left.kind !== "string" || right.kind !== "string") return reject("invalid-inventory", "aggregate observations must be strings");
          const leftItems = left.value.split(";");
          const rightItems = right.value.split(";");
          if (leftItems.pop() !== "" || rightItems.pop() !== ""
            || leftItems.length !== spec.scenarioInputs.length || rightItems.length !== spec.scenarioInputs.length) {
            return reject("invalid-inventory", "aggregate observations do not cover their literal inputs");
          }
          for (let at = 0; at < leftItems.length; at++) {
            if (leftItems[at] !== rightItems[at]) distinguishingInputs.push({ ...witness, scenarioInput: spec.scenarioInputs[at] });
          }
        } else distinguishingInputs.push(witness);
      }
    }
    if (distinguishingInputs.length === before) return reject("no-witness", `${spec.name} never differs from ${control.name}`);
  }
  passed.witness = true;
  return { ok: true, passed, observations, distinguishingInputs };
}
