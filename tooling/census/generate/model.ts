/** A closed, typed scenario language: no node contains source text or an arbitrary operation. */
export const GENERATOR_VERSION = "1.0.0";
export type Fact = "bounds" | "length";
export type Route = "call" | "callback" | "alias" | "loop" | "merge";
export type Cell = `${Fact}:${Route}`;
/** JSON atoms preserve NaN and the sign of zero. */
export type NumberValue = number | "NaN" | "-0";
export type TemplateId = "guarded-read" | "known-length" | "index-range-join" | "string-range-join";
export type Container = "variable" | "field" | "array" | "map";
export type Indirection = "direct" | "nested" | "closure";
export type Mutation = "pop" | "shift" | "splice" | "length-zero" | "push" | "unshift" | "append";
export type Callback = "forEach" | "map" | "filter" | "reduce" | "arrayFrom" | "mapForEach" | "setForEach";
export type ContextStatement = "unrelated-array" | "second-caller";

export interface Policies {
  inputSource: "literal" | "parameter";
  placement: "function" | "module";
  armOrder: "then" | "else";
  twins: boolean;
  chainLength: number;
  nestingDepth: number;
  /** Effect-call form; range joins always use direct assignment. */
  indirection: Indirection;
  container: Container;
  mutation: Mutation;
  /** Used only by callback cells; canonical default elsewhere is forEach. */
  callback: Callback;
  context: ContextStatement[];
  value: NumberValue;
}

export interface ProgramModel {
  version: 1;
  seed: number;
  ordinal: number;
  cell: Cell;
  template: TemplateId;
  policies: Policies;
  inputs: NumberValue[];
}

export interface FunctionSpec {
  name: string;
  role: "subject" | "control" | "twin" | "context";
  parameters: "number"[];
  inputs: NumberValue[][];
  /** Inputs evaluated inside a no-argument literal or module observation. */
  scenarioInputs?: NumberValue[][];
  observationEncoding?: "number-list-v1";
  /** The export this twin must equal, or the subject's effect-removed control. */
  counterpart?: string;
  /** Exact expect-ir fact after its comment prefix; only an executing control owns one. */
  shortcut?: string;
}

export interface NumericDomain {
  min?: number;
  max?: number;
  integer?: boolean;
  allowNaN?: boolean;
  reason: string;
}
export interface DomainsFile {
  version: 1;
  functions: Record<string, Record<string, NumericDomain>>;
}
export interface PrintedProgram {
  source: string;
  functions: FunctionSpec[];
  domains?: DomainsFile;
}

export function decodeNumber(value: NumberValue): number {
  return value === "NaN" ? NaN : value === "-0" ? -0 : value;
}
export function encodeNumber(value: number): NumberValue {
  if (Number.isNaN(value)) return "NaN";
  if (Object.is(value, -0)) return "-0";
  if (!Number.isFinite(value)) throw new Error("a numeric atom must be finite or NaN");
  return value;
}
export function numberSource(value: NumberValue): string {
  return typeof value === "number" ? String(value) : value;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function member<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.some((choice) => choice === value);
}
function atom(value: unknown): value is NumberValue {
  return value === "NaN" || value === "-0" || typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}
function integer(value: unknown, low: number, high: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= low && value <= high;
}
function policies(value: unknown): value is Policies {
  return record(value)
    && member(value.inputSource, ["literal", "parameter"])
    && member(value.placement, ["function", "module"])
    && member(value.armOrder, ["then", "else"])
    && typeof value.twins === "boolean"
    && integer(value.chainLength, 0, 64) && integer(value.nestingDepth, 0, 16)
    && member(value.indirection, ["direct", "nested", "closure"])
    && member(value.container, ["variable", "field", "array", "map"])
    && member(value.mutation, ["pop", "shift", "splice", "length-zero", "push", "unshift", "append"])
    && member(value.callback, ["forEach", "map", "filter", "reduce", "arrayFrom", "mapForEach", "setForEach"])
    && Array.isArray(value.context)
    && value.context.every((item) => member(item, ["unrelated-array", "second-caller"]))
    && new Set(value.context).size === value.context.length && atom(value.value);
}
export function isCell(value: unknown): value is Cell {
  return member(value, ["bounds:call", "bounds:callback", "bounds:alias", "bounds:loop", "bounds:merge",
    "length:call", "length:callback", "length:alias", "length:loop", "length:merge"]);
}
/** Validate persisted models before they can recreate a reduced project. */
export function validateModel(value: unknown): ProgramModel {
  if (!record(value) || value.version !== 1 || !integer(value.seed, 0, 0xffff_ffff)
      || !integer(value.ordinal, 0, Number.MAX_SAFE_INTEGER) || !isCell(value.cell)
      || !member(value.template, ["guarded-read", "known-length", "index-range-join", "string-range-join"])
      || !policies(value.policies) || !Array.isArray(value.inputs)
      || value.inputs.length === 0 || value.inputs.length > 64 || !value.inputs.every(atom)) {
    throw new Error("invalid stage-1 program model");
  }
  const p = value.policies;
  if (value.cell.startsWith("length:") !== (value.template === "known-length")) {
    throw new Error("the template does not establish the model's fact");
  }
  if (value.cell === "bounds:merge" && !["index-range-join", "string-range-join"].includes(value.template)
      || value.cell !== "bounds:merge" && ["index-range-join", "string-range-join"].includes(value.template)) {
    throw new Error("range-join templates belong to bounds:merge");
  }
  if (value.cell.startsWith("bounds:") && ["push", "unshift", "append"].includes(p.mutation)) {
    throw new Error("a bounds invalidator must shorten the array");
  }
  if (p.placement === "module" && p.inputSource !== "literal") {
    throw new Error("a module-scope scenario needs literal inputs at initialization");
  }
  if (value.template === "string-range-join" && (p.inputSource !== "parameter" || p.placement !== "function")) {
    throw new Error("a string range control uses its numeric exported return as its shortcut witness");
  }
  return { version: 1, seed: value.seed, ordinal: value.ordinal, cell: value.cell,
    template: value.template, policies: { ...p, context: [...p.context] }, inputs: [...value.inputs] };
}
