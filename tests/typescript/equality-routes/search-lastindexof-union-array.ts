/*---
description: lastIndexOf over union-typed array values preserves the complete pair and start-position tables without coercing objects.
features: [ts-equality-route-searching, ts-unions, ts-arrays, ts-functions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-to-primitive, ts-symbols]
---*/
// Route: SearchValue array slots reach lastIndexOf; node distinguishes numeric, textual and identity keys at every start position.
type SearchValue = number | string | bigint | boolean | null | undefined | object;
const hooks: unknown[] = [];
const shared = { id: 1 }, other = { id: 1 };
const numeric = { valueOf(): number { hooks.push("valueOf", undefined, this); return 1; } };
const textual = { toString(): string { hooks.push("toString", undefined, this); return "1"; } };
const primitive = { [Symbol.toPrimitive](hint: string): number { hooks.push("toPrimitive", hint, this); return 1; } };
const inputs: SearchValue[] = [-0, 0, NaN, Infinity, 1, "1", "", "0", 0n, 1n, true, false, null, undefined, shared, shared, other, numeric, textual, primitive];
let table = ""; const pairs: number[] = [], full: number[] = [];
for (const left of inputs) for (const right of inputs) {
  const list: SearchValue[] = [left];
  const answer = list.lastIndexOf(right); pairs.push(answer); table += (answer === 0 ? "T" : "F");
  assert.sameValue(typeof answer, "number");
}
for (let from = 0; from < inputs.length; from++) for (const query of inputs) {
  full.push(inputs.lastIndexOf(query, from));
}
assert.sameValue(table, "TTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFT");
assert.compareArray(pairs, [0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0]);
assert.compareArray(full, [0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,8,9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,8,9,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,8,9,10,11,-1,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,8,9,10,11,12,-1,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,8,9,10,11,12,13,-1,-1,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,8,9,10,11,12,13,14,14,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,8,9,10,11,12,13,15,15,-1,-1,-1,-1,1,1,-1,3,4,5,6,7,8,9,10,11,12,13,15,15,16,-1,-1,-1,1,1,-1,3,4,5,6,7,8,9,10,11,12,13,15,15,16,17,-1,-1,1,1,-1,3,4,5,6,7,8,9,10,11,12,13,15,15,16,17,18,-1,1,1,-1,3,4,5,6,7,8,9,10,11,12,13,15,15,16,17,18,19]);
assert.compareArray(hooks, []);
