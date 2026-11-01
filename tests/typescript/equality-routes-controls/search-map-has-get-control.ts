/*---
description: Control for search-map-has-get; explicit kind records and homogeneous comparisons reproduce every search and collection observation.
features: [ts-equality-route-searching, ts-unions, ts-arrays, ts-functions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-to-primitive, ts-symbols, ts-map-set]
---*/
// Control: loops over kind records replace mixed-value equality and the tested collection operation.
type SearchRecord = { kind: "number"; value: number } | { kind: "string"; value: string } | { kind: "bigint"; value: bigint } | { kind: "boolean"; value: boolean } | { kind: "null"; value: null } | { kind: "undefined"; value: undefined } | { kind: "object"; value: object };
const hooks: unknown[] = [];
const shared = { id: 1 }, other = { id: 1 };
const numeric = { valueOf(): number { hooks.push("valueOf", undefined, this); return 1; } };
const textual = { toString(): string { hooks.push("toString", undefined, this); return "1"; } };
const primitive = { [Symbol.toPrimitive](hint: string): number { hooks.push("toPrimitive", hint, this); return 1; } };
const inputs: SearchRecord[] = [{ kind: "number", value: -0 }, { kind: "number", value: 0 }, { kind: "number", value: NaN }, { kind: "number", value: Infinity }, { kind: "number", value: 1 }, { kind: "string", value: "1" }, { kind: "string", value: "" }, { kind: "string", value: "0" }, { kind: "bigint", value: 0n }, { kind: "bigint", value: 1n }, { kind: "boolean", value: true }, { kind: "boolean", value: false }, { kind: "null", value: null }, { kind: "undefined", value: undefined }, { kind: "object", value: shared }, { kind: "object", value: shared }, { kind: "object", value: other }, { kind: "object", value: numeric }, { kind: "object", value: textual }, { kind: "object", value: primitive }];
function equal(left: SearchRecord, right: SearchRecord, mode: number): boolean {
  switch (left.kind) {
    case "number": return right.kind === "number" && (mode === 2 ? Object.is(left.value, right.value) : left.value === right.value || mode === 1 && Object.is(left.value, right.value));
    case "string": return right.kind === "string" && left.value === right.value;
    case "bigint": return right.kind === "bigint" && left.value === right.value;
    case "boolean": return right.kind === "boolean" && left.value === right.value;
    case "object": return right.kind === "object" && left.value === right.value;
    case "null": return right.kind === "null";
    case "undefined": return right.kind === "undefined";
  }
}
function locate(list: SearchRecord[], query: SearchRecord, from: number, step: number, mode: number): number { for (let at = from; at >= 0 && at < list.length; at += step) if (equal(list[at], query, mode)) return at; return -1; }
type SearchEntry = { key: SearchRecord; value: number };
function entryAt(entries: SearchEntry[], query: SearchRecord): number { for (let at = 0; at < entries.length; at++) if (equal(entries[at].key, query, 1)) return at; return -1; }
let table = ""; const reads: number[] = [], sizes: number[] = [], after: number[] = [];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const contents: SearchEntry[] = [{ key: inputs[i], value: i + 1 }];
  const at = entryAt(contents, inputs[j]), present = at >= 0, value = present ? contents[at].value : undefined;
  table += present ? "T" : "F"; reads.push(value === undefined ? -1 : value); assert.sameValue(typeof value, present ? "number" : "undefined");
  if (present) contents[at].value = j + 101; else contents.push({ key: inputs[j], value: j + 101 });
  sizes.push(contents.length); after.push(contents[entryAt(contents, inputs[i])].value);
}
const population: SearchEntry[] = []; for (let i = 0; i < inputs.length; i++) { const at = entryAt(population, inputs[i]); if (at >= 0) population[at].value = i + 1; else population.push({ key: inputs[i], value: i + 1 }); }
const populationReads: number[] = []; for (const query of inputs) { const at = entryAt(population, query); assert.sameValue(at >= 0, true); populationReads.push(population[at].value); }
assert.sameValue(population.length, 18);
assert.sameValue(table, "TTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFT");
assert.compareArray(reads, [1,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,2,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,12,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,13,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,14,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,15,15,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,16,16,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,17,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,18,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,19,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,20]);
assert.compareArray(sizes, [1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1]);
assert.compareArray(after, [101,102,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,101,102,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,3,3,103,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,4,4,4,104,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,5,5,105,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,106,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,107,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,108,8,8,8,8,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,9,109,9,9,9,9,9,9,9,9,9,9,9,10,10,10,10,10,10,10,10,10,110,10,10,10,10,10,10,10,10,10,10,11,11,11,11,11,11,11,11,11,11,111,11,11,11,11,11,11,11,11,11,12,12,12,12,12,12,12,12,12,12,12,112,12,12,12,12,12,12,12,12,13,13,13,13,13,13,13,13,13,13,13,13,113,13,13,13,13,13,13,13,14,14,14,14,14,14,14,14,14,14,14,14,14,114,14,14,14,14,14,14,15,15,15,15,15,15,15,15,15,15,15,15,15,15,115,116,15,15,15,15,16,16,16,16,16,16,16,16,16,16,16,16,16,16,115,116,16,16,16,16,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,117,17,17,17,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,118,18,18,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,119,19,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,120]);
assert.compareArray(populationReads, [2,2,3,4,5,6,7,8,9,10,11,12,13,14,16,16,17,18,19,20]); assert.compareArray(hooks, []);
