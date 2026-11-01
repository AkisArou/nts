/*---
description: Control for short-optional-chain-boundary; A typed optional chain suppresses accessors inside the chain but always evaluates the next argument.
features: [ts-control-flow-routes, ts-control-flow-route-short-circuit, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-expressions, ts-tuples, ts-closures, ts-class, ts-class-fields, ts-accessors, ts-this, ts-literal-types]
---*/
// Nullable ShortBranch and ShortLeaf accessors delimit the skipped region; node logs reached getters before the unconditional following argument and returns the saved payload. The control spells the tested evaluation out in ordered steps.
type ShortValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [ShortValue, boolean, boolean][] = [[0, false, false], [-0, false, false], [NaN, false, false], ["", false, false], [undefined, false, true], [null, false, true], [false, false, false], [marker, true, false], [7, true, false], ["go", true, false], [true, true, false], [replacement, true, false]];
type ChainMode = "root-null" | "root-undefined" | "leaf-null" | "leaf-undefined" | "live";
const modes: ChainMode[] = ["root-null", "root-undefined", "leaf-null", "leaf-undefined", "live"];
class ShortLeaf {
  value: ShortValue; log: unknown[];
  constructor(value: ShortValue, log: unknown[]) { this.value = value; this.log = log; }
  get payload(): ShortValue { this.log.push("payload", this.value); return this.value; }
}
class ShortBranch {
  leaf: ShortLeaf | null | undefined; log: unknown[];
  constructor(leaf: ShortLeaf | null | undefined, log: unknown[]) { this.leaf = leaf; this.log = log; }
  get child(): ShortLeaf | null | undefined { this.log.push("child", this.leaf); return this.leaf; }
}
function inspect(input: ShortValue, mode: ChainMode): void {
  const log: unknown[] = [], leaf = new ShortLeaf(input, log); let leafValue: ShortLeaf | null | undefined = leaf;
  if (mode === "leaf-null") leafValue = null; else if (mode === "leaf-undefined") leafValue = undefined;
  let rootValue: ShortBranch | null | undefined = new ShortBranch(leafValue, log), state: ShortValue = input;
  if (mode === "root-null") rootValue = null; else if (mode === "root-undefined") rootValue = undefined;
  function source(): ShortBranch | null | undefined { log.push("source", rootValue); return rootValue; }
  function after(): ShortValue { log.push("after", state); state = replacement; return state; }
  function take(value: ShortValue, tail: ShortValue): ShortValue { log.push("take", value, tail); return value; }
  let selected: ShortValue = undefined; const root = source();
  if (root !== null) if (root !== undefined) { const child = root.child; if (child !== null) if (child !== undefined) selected = child.payload; }
  const tail = after(), actual = take(selected, tail);
  const expectedLog: unknown[] = ["source", rootValue]; let expected: ShortValue = undefined;
  if (mode !== "root-null") if (mode !== "root-undefined") expectedLog.push("child", leafValue);
  if (mode === "live") { expected = input; expectedLog.push("payload", input); }
  expectedLog.push("after", input, "take", expected, replacement); same(actual, expected); same(state, replacement); assert.compareArray(log, expectedLog);
}
for (const row of rows) for (const mode of modes) inspect(row[0], mode);
