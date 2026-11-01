/*---
description: Control for search-set-has; explicit kind records and homogeneous comparisons reproduce every search and collection observation.
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
let table = ""; const sizes: number[] = [];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < inputs.length; j++) {
  const contents: SearchRecord[] = [inputs[i]]; const present = locate(contents, inputs[j], 0, 1, 1) >= 0; table += present ? "T" : "F";
  if (!present) contents.push(inputs[j]); sizes.push(contents.length); assert.sameValue(locate(contents, inputs[i], 0, 1, 1) >= 0, true); assert.sameValue(locate(contents, inputs[j], 0, 1, 1) >= 0, true);
}
const population: SearchRecord[] = []; for (const value of inputs) if (locate(population, value, 0, 1, 1) < 0) population.push(value);
assert.sameValue(population.length, 18); for (const query of inputs) assert.sameValue(locate(population, query, 0, 1, 1) >= 0, true);
assert.sameValue(table, "TTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFTTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFFFFFT");
assert.compareArray(sizes, [1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1]); assert.compareArray(hooks, []);
