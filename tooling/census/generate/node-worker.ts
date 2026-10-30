// Host-side execution only. Nothing in this file is printed into a fixture.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { decodeNumber } from "./model.ts";
import type { NumberValue } from "./model.ts";

export type ObservedValue =
  | { kind: "number"; value: number | "NaN" | "-0" | "Infinity" | "-Infinity" }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "undefined" }
  | { kind: "null" };
export interface Observation {
  name: string;
  inputs: NumberValue[][];
  values: ObservedValue[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function atom(value: unknown): value is NumberValue {
  return value === "NaN" || value === "-0" || typeof value === "number" && Number.isFinite(value);
}
function input(value: unknown): value is NumberValue[] {
  return Array.isArray(value) && value.every(atom);
}
function encode(value: unknown): ObservedValue {
  if (value === undefined) return { kind: "undefined" };
  if (value === null) return { kind: "null" };
  if (typeof value === "string") return { kind: "string", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "number") {
    return { kind: "number", value: Number.isNaN(value) ? "NaN" : Object.is(value, -0) ? "-0"
      : value === Infinity ? "Infinity" : value === -Infinity ? "-Infinity" : value };
  }
  throw new Error("an export returned a value outside the stage-1 observation types");
}

async function main(): Promise<void> {
  const source = process.argv[2];
  if (!source) throw new Error("the worker needs an entry file");
  const parsed: unknown = JSON.parse(readFileSync(0, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("the worker needs a function inventory");
  const functions: { name: string; inputs: NumberValue[][] }[] = [];
  for (const item of parsed) {
    if (!record(item) || typeof item.name !== "string" || !Array.isArray(item.inputs)
      || item.inputs.length === 0 || !item.inputs.every(input)) throw new Error("invalid function inputs");
    functions.push({ name: item.name, inputs: item.inputs });
  }
  const names = functions.map((item) => item.name);
  if (new Set(names).size !== names.length) throw new Error("duplicate exported function names");
  const module: Record<string, unknown> = await import(pathToFileURL(source).href);
  if (JSON.stringify(Object.keys(module).sort()) !== JSON.stringify([...names].sort())) {
    throw new Error("the actual export inventory differs from the manifest");
  }
  const runs: Observation[][] = [];
  // Repeat in the same instance too: fresh processes alone miss mutable module state.
  for (let pass = 0; pass < 2; pass++) {
    const observations: Observation[] = [];
    for (const spec of functions) {
      const fn = module[spec.name];
      if (typeof fn !== "function") throw new Error(`export ${spec.name} is not a function`);
      const values: ObservedValue[] = [];
      for (const args of spec.inputs) values.push(encode(fn(...args.map(decodeNumber))));
      observations.push({ name: spec.name, inputs: spec.inputs, values });
    }
    runs.push(observations);
  }
  process.stdout.write(JSON.stringify({ version: 1, runs }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
