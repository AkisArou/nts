/*---
description: Control for search-map-delete; explicit kind records and homogeneous comparisons reproduce every search and collection observation.
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
let table = ""; const sizes: number[] = [], remaining: number[] = [];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const contents: SearchEntry[] = [{ key: inputs[i], value: i + 1 }];
  const at = entryAt(contents, inputs[j]), removed = at >= 0; if (removed) contents.splice(at, 1);
  table += removed ? "T" : "F"; sizes.push(contents.length); const left = entryAt(contents, inputs[i]);
  remaining.push(left >= 0 ? contents[left].value : -1); assert.sameValue(left >= 0, !removed); assert.sameValue(entryAt(contents, inputs[j]) >= 0, false);
}
assert.sameValue(table, "TTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFT");
assert.compareArray(sizes, [0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0]);
assert.compareArray(remaining, [-1,-1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,-1,-1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,3,3,-1,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,4,4,4,-1,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,5,5,-1,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,-1,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,-1,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,-1,8,8,8,8,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,9,-1,9,9,9,9,9,9,9,9,9,9,9,10,10,10,10,10,10,10,10,10,-1,10,10,10,10,10,10,10,10,10,10,11,11,11,11,11,11,11,11,11,11,-1,11,11,11,11,11,11,11,11,11,12,12,12,12,12,12,12,12,12,12,12,-1,12,12,12,12,12,12,12,12,13,13,13,13,13,13,13,13,13,13,13,13,-1,13,13,13,13,13,13,13,14,14,14,14,14,14,14,14,14,14,14,14,14,-1,14,14,14,14,14,14,15,15,15,15,15,15,15,15,15,15,15,15,15,15,-1,-1,15,15,15,15,16,16,16,16,16,16,16,16,16,16,16,16,16,16,-1,-1,16,16,16,16,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,-1,17,17,17,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,18,-1,18,18,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,19,-1,19,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,-1]); assert.compareArray(hooks, []);
