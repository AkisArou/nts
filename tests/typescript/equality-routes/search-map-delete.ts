/*---
description: Union-keyed Map deletion preserves every pair, surviving payload and exact remaining size.
features: [ts-equality-route-searching, ts-unions, ts-arrays, ts-functions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-to-primitive, ts-symbols, ts-map-set]
---*/
// Route: Map<SearchValue, number>.delete receives every mixed-kind key; node removes only SameValueZero matches and leaves a second deletion false.
type SearchValue = number | string | bigint | boolean | null | undefined | object;
const hooks: unknown[] = [];
const shared = { id: 1 }, other = { id: 1 };
const numeric = { valueOf(): number { hooks.push("valueOf", undefined, this); return 1; } };
const textual = { toString(): string { hooks.push("toString", undefined, this); return "1"; } };
const primitive = { [Symbol.toPrimitive](hint: string): number { hooks.push("toPrimitive", hint, this); return 1; } };
const inputs: SearchValue[] = [-0, 0, NaN, Infinity, 1, "1", "", "0", 0n, 1n, true, false, null, undefined, shared, shared, other, numeric, textual, primitive];
let table = ""; const sizes: number[] = [], remaining: number[] = [];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const contents = new Map<SearchValue, number>([[inputs[i], i + 1]]);
  const removed = contents.delete(inputs[j]); table += removed ? "T" : "F"; sizes.push(contents.size);
  remaining.push(contents.get(inputs[i]) ?? -1); assert.sameValue(contents.has(inputs[i]), !removed); assert.sameValue(contents.delete(inputs[j]), false);
}
assert.sameValue(table, "TTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFT");
assert.compareArray(sizes, [0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0]);
assert.compareArray(remaining, [-1,-1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,-1,-1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,3,3,-1,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,4,4,4,-1,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,5,5,-1,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,-1,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,-1,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,-1,8,8,8,8,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,9,-1,9,9,9,9,9,9,9,9,9,9,9,10,10,10,10,10,10,10,10,10,-1,10,10,10,10,10,10,10,10,10,10,11,11,11,11,11,11,11,11,11,11,-1,11,11,11,11,11,11,11,11,11,12,12,12,12,12,12,12,12,12,12,12,-1,12,12,12,12,12,12,12,12,13,13,13,13,13,13,13,13,13,13,13,13,-1,13,13,13,13,13,13,13,14,14,14,14,14,14,14,14,14,14,14,14,14,-1,14,14,14,14,14,14,15,15,15,15,15,15,15,15,15,15,15,15,15,15,-1,-1,15,15,15,15,16,16,16,16,16,16,16,16,16,16,16,16,16,16,-1,-1,16,16,16,16,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,-1,17,17,17,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,-1,18,18,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,-1,19,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,-1]); assert.compareArray(hooks, []);
