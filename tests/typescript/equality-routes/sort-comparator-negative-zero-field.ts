/*---
description: A union-typed comparator field preserves negative-zero pair results and stable equal-key ordering.
features: [ts-equality-route-sorting, ts-arrays, ts-unions, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-functions, ts-function-types, ts-interfaces]
---*/
// Route: a comparator stored in a declared field returns -0 for equal numeric keys; node retains every raw result and keeps equal-key entries in order.
interface SortObject { id: number; rank: number; }
const hookLog: unknown[] = []; const identity: SortObject = { id: 1, rank: 0 }, twin: SortObject = { id: 2, rank: 0 };
type SortValue = number | string | bigint | boolean | null | undefined | SortObject;
const inputs: SortValue[] = [-0, 0, NaN, Infinity, 1, "1", "", "0", 0n, 1n, true, false, null, undefined, identity, identity, twin, 10, 2, "10", "2", -Infinity, 1.5, 2147483648];
function finiteKey(value: number): number { return Number.isNaN(value) ? 5 : value === Infinity ? 4 : value === -Infinity ? -4 : value; }
function numeric(value: SortValue): number { return typeof value === "object" && value !== null ? value.rank : Number(value); }
const holder: { compare: (left: SortValue, right: SortValue) => number } = { compare(left, right) { const a = finiteKey(numeric(left)), b = finiteKey(numeric(right)); return a === b ? -0 : a < b ? -1 : 1; } };
function ordered(values: SortValue[], comparator: (left: SortValue, right: SortValue) => number): SortValue[] { return values.sort(comparator); }
const answers: number[] = [];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const result = holder.compare(inputs[i], inputs[j]); answers.push(result); assert.sameValue(typeof result, "number");
}
assert.compareArray(answers, [-0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, -0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, 1, 1, -0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -0, 1, 1, 1, -1, 1, -1, 1, 1, 1, -1, 1, 1, -1, -0, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, -1, 1, -1, 1, 1, 1, -1, 1, 1, -1, -1, -0, -0, 1, 1, 1, -0, -0, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, -0, -0, 1, 1, 1, -0, -0, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, -0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, -0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, -0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, -0, -0, 1, 1, 1, -0, -0, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, -0, -0, 1, 1, 1, -0, -0, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, -0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, -0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, 1, 1, -0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -0, 1, 1, 1, -1, 1, -1, 1, 1, 1, -1, -0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, -0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, -0, -0, -1, -1, -1, -1, -0, -0, -0, -1, -1, -0, -0, -1, -0, -0, -0, -1, -1, -1, -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -0, 1, -0, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, -1, -0, -1, -0, 1, 1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -0, 1, -0, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, -1, -0, -1, -0, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -0, -1, -1, 1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -0, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -0]); assert.sameValue(answers.length, inputs.length * inputs.length);
hookLog.length = 0; const original = inputs.slice(), work = inputs.slice(), result = ordered(work, holder.compare);
assert.sameValue(Object.is(result, work), true); assert.sameValue(result.length, inputs.length);
const order: number[] = [21, 0, 1, 6, 7, 8, 11, 12, 14, 15, 16, 4, 5, 9, 10, 22, 18, 20, 3, 2, 17, 19, 23, 13];
for (let i = 0; i < order.length; i++) { assert.sameValue(result[i], inputs[order[i]]); assert.sameValue(typeof result[i], typeof inputs[order[i]]); }
assert.compareArray(inputs, original);
assert.compareArray(hookLog, []);
