/*---
description: Hard union values cross a set and switch narrowing with exact payload and branch checks.
features: [ts-union-routes, ts-union-route-values, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-unknown, ts-map-set, ts-unions, ts-discriminated-unions, ts-narrowing, ts-never]
---*/
// Set storage carries all hard payloads to switch; Node keeps the payload and branch, including negative zero and reference identity.
interface EdgePoint { id: number; }
interface EdgeRecord { kind: string; num: number; str: string; big: bigint; bool: boolean; nil: null; undef: undefined; ref: EdgePoint; text: string; }
function fixture(kind: string, num: number, str: string, big: bigint, bool: boolean, ref: EdgePoint, text: string): EdgeRecord { return { kind, num, str, big, bool, nil: null, undef: undefined, ref, text }; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const marker: EdgePoint = { id: 7 };
const rows: EdgeRecord[] = [
  fixture("num", -0, "decoy", 5n, true, marker, "0"), fixture("str", 19, "", 7n, true, marker, ""),
  fixture("big", 23, "decoy", 0n, true, marker, "0"), fixture("bool", 29, "decoy", 9n, false, marker, "false"),
  fixture("nil", 31, "decoy", 11n, true, marker, "null"), fixture("undef", 37, "decoy", 13n, true, marker, "undefined"),
  fixture("ref", 41, "decoy", 17n, true, marker, "[object Object]"), fixture("num", NaN, "decoy", 19n, true, marker, "NaN")
];
function expected(row: EdgeRecord, zero: boolean): unknown { if (row.kind === "num") return zero && row.num === 0 ? 0 : row.num; if (row.kind === "str") return row.str; if (row.kind === "big") return row.big; if (row.kind === "bool") return row.bool; if (row.kind === "nil") return row.nil; if (row.kind === "undef") return row.undef; return row.ref; }
type EdgeUnion = { kind: "number"; value: number } | { kind: "string"; value: string } | { kind: "bigint"; value: bigint } | { kind: "boolean"; value: boolean } | { kind: "null"; value: null } | { kind: "undefined"; value: undefined } | { kind: "object"; value: EdgePoint };
function make(row: EdgeRecord): EdgeUnion { if (row.kind === "num") return { kind: "number", value: row.num }; if (row.kind === "str") return { kind: "string", value: row.str }; if (row.kind === "big") return { kind: "bigint", value: row.big }; if (row.kind === "bool") return { kind: "boolean", value: row.bool }; if (row.kind === "nil") return { kind: "null", value: row.nil }; if (row.kind === "undef") return { kind: "undefined", value: row.undef }; return { kind: "object", value: row.ref }; }
function observe(value: EdgeUnion, log: string[]): unknown {
  switch (value.kind) {
    case "number": log.push("number"); return value.value;
    case "string": log.push("string"); return value.value;
    case "bigint": log.push("bigint"); return value.value;
    case "boolean": log.push("boolean"); return value.value;
    case "null": log.push("null"); return value.value;
    case "undefined": log.push("undefined"); return value.value;
    case "object": log.push("object"); return value.value;
    default: { const impossible: never = value; throw new Test262Error("unreachable " + String(impossible)); }
  }
}
const log: string[] = [], branches: string[] = ["number", "string", "bigint", "boolean", "null", "undefined", "object", "number"];
const storage = new Set<EdgeUnion>();
for (const round of [0, 1]) for (const row of rows) {
  const current = make(row);
  storage.clear(); storage.add(current); storage.add(current); same(storage.size, 1);
  for (const read of storage) {
    same(read, current);
    const actual = observe(read, log); same(actual, expected(row, false));
    const printed = String(actual); same(printed, row.text); console.log(printed);
  }
}
assert.compareArray(log, branches.concat(branches));
