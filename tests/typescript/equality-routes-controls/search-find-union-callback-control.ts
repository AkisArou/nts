/*---
description: Control for search-find-union-callback; explicit kind records and homogeneous comparisons reproduce every search and collection observation.
features: [ts-equality-route-searching, ts-unions, ts-arrays, ts-functions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-objects, ts-to-primitive, ts-symbols, ts-function-types, ts-arrow-functions]
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
const expected = "TFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFT", expectedPositions = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,14,16,17,18,19];
let table = ""; const stops: number[] = [], counts: number[] = [];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const list: SearchRecord[] = [inputs[i]], query = inputs[j]; let calls = 0, hit = -1;
  const predicate: (value: SearchRecord, at: number) => boolean = (value, at) => { calls++; const same = equal(value, query, 2); if (same) hit = at; return same; };
  let found: SearchRecord | undefined = undefined; for (let at = 0; at < list.length; at++) if (predicate(list[at], at)) { found = list[at]; break; }
  const wanted = expected[i * inputs.length + j] === "T"; table += hit === 0 ? "T" : "F"; assert.sameValue(calls, 1);
  if (wanted) { if (found === undefined) throw new Error("missing record"); assert.sameValue(Object.is(found, inputs[i]), true); } else assert.sameValue(found, undefined);
}
for (let j = 0; j < inputs.length; j++) {
  const query = inputs[j]; let calls = 0, hit = -1;
  const predicate: (value: SearchRecord, at: number) => boolean = (value, at) => { calls++; const same = equal(value, query, 2); if (same) hit = at; return same; };
  let found: SearchRecord | undefined = undefined; for (let at = 0; at < inputs.length; at++) if (predicate(inputs[at], at)) { found = inputs[at]; break; }
  if (found === undefined) throw new Error("missing full-population record");
  stops.push(hit); counts.push(calls); assert.sameValue(Object.is(found, inputs[expectedPositions[j]]), true);
}
assert.sameValue(table, expected); assert.compareArray(stops, expectedPositions);
assert.compareArray(counts, [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,15,17,18,19,20]); assert.compareArray(hooks, []);
