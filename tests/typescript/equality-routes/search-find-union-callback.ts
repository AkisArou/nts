/*---
description: find with a union-typed Object.is callback preserves every pair, found value and first stopping position.
features: [ts-equality-route-searching, ts-unions, ts-arrays, ts-functions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-to-primitive, ts-symbols, ts-function-types, ts-arrow-functions]
---*/
// Route: (SearchValue, number) => boolean callbacks compare every pair; node finds NaN, distinguishes signed zeros and records a found undefined separately from absence.
type SearchValue = number | string | bigint | boolean | null | undefined | object;
const hooks: unknown[] = [];
const shared = { id: 1 }, other = { id: 1 };
const numeric = { valueOf(): number { hooks.push("valueOf", undefined, this); return 1; } };
const textual = { toString(): string { hooks.push("toString", undefined, this); return "1"; } };
const primitive = { [Symbol.toPrimitive](hint: string): number { hooks.push("toPrimitive", hint, this); return 1; } };
const inputs: SearchValue[] = [-0, 0, NaN, Infinity, 1, "1", "", "0", 0n, 1n, true, false, null, undefined, shared, shared, other, numeric, textual, primitive];
const expected = "TFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFT", expectedPositions = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,14,16,17,18,19];
let table = ""; const stops: number[] = [], counts: number[] = [];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const list: SearchValue[] = [inputs[i]], query = inputs[j]; let calls = 0, hit = -1;
  const predicate: (value: SearchValue, at: number) => boolean = (value, at) => { calls++; const same = Object.is(value, query); if (same) hit = at; return same; };
  const found = list.find(predicate);
  const wanted = expected[i * inputs.length + j] === "T"; table += hit === 0 ? "T" : "F"; assert.sameValue(calls, 1);
  assert.sameValue(Object.is(found, wanted ? inputs[i] : undefined), true);
}
for (let j = 0; j < inputs.length; j++) {
  const query = inputs[j]; let calls = 0, hit = -1;
  const predicate: (value: SearchValue, at: number) => boolean = (value, at) => { calls++; const same = Object.is(value, query); if (same) hit = at; return same; };
  const found = inputs.find(predicate);
  stops.push(hit); counts.push(calls); assert.sameValue(Object.is(found, inputs[expectedPositions[j]]), true);
}
assert.sameValue(table, expected); assert.compareArray(stops, expectedPositions);
assert.compareArray(counts, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,15,17,18,19,20]); assert.compareArray(hooks, []);
