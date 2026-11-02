/*---
description: Plain string-hook record control for An array returned through an extended array interface respects explicit concat flags and their absence.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-optional-properties, ts-unions, ts-numbers, ts-record]
---*/
// String hook record: A function returns an ArrayBatch with a true, false or absent spread flag; node spreads arrays by default and retains a false-flagged array by identity.
const hookKey = "hook:concat";
interface ArrayBatch { values: number[]; keys: string[]; flags: Record<string, boolean>; }
function make(values: number[], spread: boolean | undefined): ArrayBatch {
  const target: ArrayBatch = { values: values.slice(), keys: [], flags: {} };
  if (spread !== undefined) { target.keys.push(hookKey); target.flags[hookKey] = spread; } return target;
}
function concatenate(target: ArrayBatch): unknown[] {
  const spread = target.keys.includes(hookKey) ? target.flags[hookKey] : true, out: unknown[] = ["start"];
  if (!spread) { out.push(target); return out; } out.length = target.values.length + 1;
  for (let i = 0; i < target.values.length; i++) if (i in target.values) out[i + 1] = target.values[i]; return out;
}
function hookKeys(target: ArrayBatch): string[] { return target.keys.slice(); }
function items(target: ArrayBatch): number[] { return target.values; }
const sparse: number[] = [3]; sparse.length = 3; sparse[2] = 9;
const inputs: number[][] = [[], [-0, NaN], [1, 2, 3], sparse];
for (const values of inputs) for (const flag of [undefined, false, true]) {
  const target = make(values, flag), result = concatenate(target), expected: unknown[] = ["start"];
  if (flag !== false) { expected.length = values.length + 1; for (let i = 0; i < values.length; i++) if (i in values) expected[i + 1] = values[i]; }
  else expected.push(target);
  assert.compareArray(result, expected); assert.compareArray(Object.keys(result), Object.keys(expected));
  assert.compareArray(hookKeys(target), flag === undefined ? [] : [hookKey]);
  assert.compareArray(items(target), values); assert.compareArray(Object.keys(items(target)), Object.keys(values));
  if (flag === false) assert.sameValue(result[1], target);
}
