/*---
description: Default sort through a union-array parameter preserves every pair order, string ordering, stable identities and undefined last.
features: [ts-equality-route-sorting, ts-arrays, ts-unions, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-functions]
---*/
// Route: a SortValue[] parameter reaches default sort; node compares string forms, keeps equal keys stable and mutates the original array.
interface SortObject { id: number; rank: number; }
const hookLog: unknown[] = []; const identity: SortObject = { id: 1, rank: 0 }, twin: SortObject = { id: 2, rank: 0 };
type SortValue = number | string | bigint | boolean | null | undefined | SortObject;
const inputs: SortValue[] = [-0, 0, NaN, Infinity, 1, "1", "", "0", 0n, 1n, true, false, null, undefined, identity, identity, twin, 10, 2, "10", "2", -Infinity, 1.5, 2147483648];
function ordered(values: SortValue[]): SortValue[] { return values.sort(); }
const expectedTable = "TTTTTTFTTTTTTTTTTTTTTFTTTTTTTTFTTTTTTTTTTTTTTFTTFFTFFFFFFFTTTTTTTFFFFFFFFFTTFFFFFFTTTTTTTFFFFFFFFFTTTTFFFTTTTTTTTTTTTFTTFFTTTTFFFTTTTTTTTTTTTFTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTFTTTTTTTTTTTTTTFTTTTTTTTFTTTTTTTTTTTTTTFTTFFTTTTFFFTTTTTTTTTTTTFTTFFFFFFFFFFTFFTFFFFFFFFFFFFFFFFFFFFTTTTFFFFFFFFFFFFFFFFFFFFTFTTFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTTTTTTTFFFFFFFFFFFFFFFFFTTTTTTTFFFFFFFFFFFFFFFFFTTTTTTTFFFFFFFFFTTFFFFFFTTTTTTTTTTTFFTFFTTFFFFFFTTTTTTTFTFTFFTFFTTFFFFFFTTTTTTTTTTTFFTFFTTFFFFFFTTTTTTTFTFTFFTTTTTTTFTTTTTTTTTTTTTTTTTFFTTFFFFFFTTTTTTTTTTTFTTFFTTFFFFFFTTTTTTTFFFFFFT"; let table = "";
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const work = [inputs[i], inputs[j]], result = ordered(work); const same = Object.is(result[0], inputs[i]) && Object.is(result[1], inputs[j]); table += same ? "T" : "F";
  const wanted = expectedTable[i * inputs.length + j] === "T" ? [inputs[i], inputs[j]] : [inputs[j], inputs[i]]; assert.compareArray(result, wanted); assert.sameValue(Object.is(result, work), true);
}
assert.sameValue(table, expectedTable); assert.sameValue(table.length, inputs.length * inputs.length);
hookLog.length = 0; const original = inputs.slice(), work = inputs.slice(), result = ordered(work);
assert.sameValue(Object.is(result, work), true); assert.sameValue(result.length, inputs.length);
const order: number[] = [6, 21, 0, 1, 7, 8, 4, 5, 9, 22, 17, 19, 18, 20, 23, 3, 2, 14, 15, 16, 11, 12, 10, 13];
for (let i = 0; i < order.length; i++) { assert.sameValue(result[i], inputs[order[i]]); assert.sameValue(typeof result[i], typeof inputs[order[i]]); }
assert.compareArray(inputs, original);
assert.compareArray(hookLog, []);
