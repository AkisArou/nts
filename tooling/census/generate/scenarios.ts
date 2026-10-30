import type { Cell, ContextStatement, NumberValue, ProgramModel, TemplateId } from "./model.ts";
import { decodeNumber, validateModel } from "./model.ts";
import { Random } from "./random.ts";

export const CELLS: readonly Cell[] = [
  "bounds:call", "bounds:callback", "bounds:alias", "bounds:loop", "bounds:merge",
  "length:call", "length:callback", "length:alias", "length:loop", "length:merge",
];
export const BOUNDARIES: readonly NumberValue[] = [
  0, -1, 2147483647, 2147483648, 4294967296, 9007199254740992, "-0", "NaN", 0.5, -0.5, 1.5,
];
// Stress sizes around plausible budgets, not claims about nts's implementation.
export const CHAIN_LENGTHS = [0, 1, 2, 15, 16, 17, 23, 24, 25, 31, 32, 33];
export const NESTING_DEPTHS = [0, 1, 2, 3, 9, 10, 11];

function streamSeed(seed: number, ordinal: number, cell: Cell): number {
  let value = (seed ^ Math.imul(ordinal + 1, 0x9e3779b1)) >>> 0;
  for (const char of cell) value = Math.imul(value ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return value;
}

/** An independent stream per ordinal keeps replay independent of prior attempts. */
export function generateModel(seed: number, ordinal: number, cell: Cell): ProgramModel {
  const rng = new Random(streamSeed(seed, ordinal, cell));
  const context: ContextStatement[] = [];
  if (rng.chance()) context.push("unrelated-array");
  if (rng.chance()) context.push("second-caller");
  const placement = rng.pick(["function", "module"]);
  const inputSource = placement === "module" ? "literal" : rng.pick(["literal", "parameter"]);
  let template: TemplateId = cell.startsWith("length:") ? "known-length" : "guarded-read";
  if (cell === "bounds:merge") {
    template = inputSource === "parameter" && rng.chance() ? "string-range-join" : "index-range-join";
  }
  const mutation = cell.startsWith("bounds:")
    ? rng.pick(["pop", "shift", "splice", "length-zero"])
    : rng.pick(["push", "unshift", "append", "pop", "splice", "length-zero"]);
  // Always retain both a taken and an untaken effect and both sides of a join.
  const inputs: NumberValue[] = [0, 1, 2, 3, 4, 7, -1, rng.pick(BOUNDARIES), rng.pick(BOUNDARIES)];
  const unique = inputs.filter((value, index) => inputs.findIndex((other) => Object.is(decodeNumber(other), decodeNumber(value))) === index);
  const rangeJoin = cell === "bounds:merge";
  return validateModel({
    version: 1, seed, ordinal, cell, template,
    policies: {
      placement, inputSource,
      armOrder: rng.pick(["then", "else"]), twins: cell.endsWith(":merge") || rng.chance(),
      chainLength: rng.pick(CHAIN_LENGTHS), nestingDepth: rangeJoin ? 0 : rng.pick(NESTING_DEPTHS),
      indirection: rangeJoin ? "direct" : rng.pick(["direct", "nested", "closure"]),
      container: template === "string-range-join" ? "variable"
        : rangeJoin ? rng.pick(["variable", "field"]) : rng.pick(["variable", "field", "array", "map"]),
      mutation: rangeJoin ? "pop" : mutation,
      callback: cell.endsWith(":callback")
        ? rng.pick(["forEach", "map", "filter", "reduce", "arrayFrom", "mapForEach", "setForEach"]) : "forEach",
      context, value: rng.pick(BOUNDARIES),
    }, inputs: unique,
  });
}

/** NaN and signed zero are irreducible; fractions remain fractions and signs survive. */
export function smallerValues(value: NumberValue): NumberValue[] {
  if (typeof value !== "number" || value === 0) return [];
  if (!Number.isInteger(value)) {
    const minimum = value < 0 ? -0.5 : 0.5;
    return Math.abs(value) <= 0.5 ? [] : [minimum];
  }
  const minimum = value < 0 ? -1 : 1;
  const half = Math.trunc(value / 2);
  return [...new Set([minimum, half])].filter((candidate) => candidate !== value && candidate !== 0);
}

/** Model reductions precede text deletion and never change the cell or template. */
export function modelCandidates(model: ProgramModel): ProgramModel[] {
  const candidates: ProgramModel[] = [];
  const p = model.policies;
  for (let i = 0; i < p.context.length; i++) {
    candidates.push({ ...model, policies: { ...p, context: p.context.filter((_, at) => at !== i) } });
  }
  for (const field of ["chainLength", "nestingDepth"] satisfies ("chainLength" | "nestingDepth")[]) {
    const old = p[field];
    for (const value of [...new Set([0, Math.floor(old / 2), old - 1])]) {
      if (value >= 0 && value < old) candidates.push({ ...model, policies: { ...p, [field]: value } });
    }
  }
  if (p.indirection !== "direct") candidates.push({ ...model, policies: { ...p, indirection: "direct" } });
  if (p.container !== "variable") candidates.push({ ...model, policies: { ...p, container: "variable" } });
  for (const value of smallerValues(p.value)) candidates.push({ ...model, policies: { ...p, value } });
  for (let i = 0; i < model.inputs.length; i++) {
    if (model.inputs.length > 1) candidates.push({ ...model, inputs: model.inputs.filter((_, at) => at !== i) });
    for (const value of smallerValues(model.inputs[i])) {
      candidates.push({ ...model, inputs: model.inputs.map((old, at) => at === i ? value : old) });
    }
  }
  return candidates;
}
