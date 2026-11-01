/*---
description: Control for values-map-typeof; carry separate typed payloads in one kind record.
features: [ts-union-routes, ts-union-route-values, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-unknown, ts-map-set]
---*/
// Keep the storage and observations; replace the union and narrowing with required payload fields and kind branches.
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
function make(row: EdgeRecord): EdgeRecord { return { kind: row.kind, num: row.num, str: row.str, big: row.big, bool: row.bool, nil: row.nil, undef: row.undef, ref: row.ref, text: row.text }; }
function observe(value: EdgeRecord, log: string[]): unknown {
  if (value.kind === "num") { log.push("number"); return value.num; }
  if (value.kind === "str") { log.push("string"); return value.str; }
  if (value.kind === "big") { log.push("bigint"); return value.big; }
  if (value.kind === "bool") { log.push("boolean"); return value.bool; }
  if (value.kind === "nil") { log.push("null"); return value.nil; }
  if (value.kind === "undef") { log.push("undefined"); return value.undef; }
  log.push("object"); return value.ref;
}
const log: string[] = [], branches: string[] = ["number", "string", "bigint", "boolean", "null", "undefined", "object", "number"];
const storage = new Map<string, EdgeRecord>();
for (const round of [0, 1]) for (const row of rows) {
  const current = make(row);
  storage.set("value", current); same(storage.size, 1);
  for (const read of storage.values()) {
    same(read, current);
    const actual = observe(read, log); same(actual, expected(row, false));
    const printed = String(actual); same(printed, row.text); console.log(printed);
  }
}
assert.compareArray(log, branches.concat(branches));
