/*---
description: Plain string-hook record control for A spreadable array-like object held in an interface field contributes its indexed elements to concat.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-numbers, ts-record]
---*/
// String hook record: A Holder field carries a typed array-like with a spread flag; node spreads its present indices only when the flag is true.
const hookKey = "hook:concat";
interface Batch { length: number; data: Record<number, number>; keys: string[]; flags: Record<string, boolean>; }
interface Holder { batch: Batch; }
function make(values: number[], spread: boolean): Batch {
  const target: Batch = { length: values.length, data: {}, keys: [hookKey], flags: { [hookKey]: spread } };
  for (let i = 0; i < values.length; i++) if (i in values) target.data[i] = values[i]; return target;
}
function concatenate(holder: Holder): unknown[] {
  const target = holder.batch, out: unknown[] = ["start"], spread = target.keys.includes(hookKey) && target.flags[hookKey];
  if (!spread) { out.push(target); return out; } out.length = target.length + 1;
  for (let i = 0; i < target.length; i++) if (i in target.data) out[i + 1] = target.data[i]; return out;
}
function at(target: Batch, index: number): number | undefined { return target.data[index]; }
function has(target: Batch, index: number): boolean { return index in target.data; }
const sparse: number[] = [3]; sparse.length = 3; sparse[2] = 9;
const inputs: number[][] = [[], [-0, NaN], [1, 2, 3], sparse];
for (const values of inputs) for (const spread of [false, true]) {
  const holder: Holder = { batch: make(values, spread) }, result = concatenate(holder), expected: unknown[] = ["start"];
  if (spread) { expected.length = values.length + 1; for (let i = 0; i < values.length; i++) if (i in values) expected[i + 1] = values[i]; }
  else expected.push(holder.batch);
  assert.compareArray(result, expected); assert.compareArray(Object.keys(result), Object.keys(expected));
  assert.sameValue(holder.batch.length, values.length);
  for (let i = 0; i < values.length; i++) { assert.sameValue(at(holder.batch, i), values[i]); assert.sameValue(has(holder.batch, i), i in values); }
  if (!spread) assert.sameValue(result[1], holder.batch);
}
