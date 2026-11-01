/*---
description: Hard union values cross a tuple and equality narrowing with exact payload and branch checks.
features: [ts-union-routes, ts-union-route-values, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-unknown, ts-tuples, ts-destructuring, ts-unions, ts-narrowing]
---*/
// Tuple storage carries all hard payloads to equality; Node keeps the payload and branch, including negative zero and reference identity.
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
type EdgeUnion = number | string | bigint | boolean | null | undefined | EdgePoint;
function make(row: EdgeRecord): EdgeUnion { if (row.kind === "num") return row.num; if (row.kind === "str") return row.str; if (row.kind === "big") return row.big; if (row.kind === "bool") return row.bool; if (row.kind === "nil") return row.nil; if (row.kind === "undef") return row.undef; return row.ref; }
function observe(value: EdgeUnion, log: string[]): unknown {
  if (value === 0) { log.push("zero"); return value; }
  if (value !== value) { log.push("nan"); return value; }
  if (value === "") { log.push("empty"); return value; }
  if (value === 0n) { log.push("zero-bigint"); return value; }
  if (value === false) { log.push("false"); return value; }
  if (value === null) { log.push("null"); return value; }
  if (value === undefined) { log.push("undefined"); return value; }
  log.push("object"); return value;
}
const log: string[] = [], branches: string[] = ["zero", "empty", "zero-bigint", "false", "null", "undefined", "object", "nan"];
const storage: [string, EdgeUnion] = ["slot", make(rows[0])];
for (const round of [0, 1]) for (const row of rows) {
  const current = make(row);
  storage[1] = current; const [label, read] = storage; same(label, "slot"); same(storage.length, 2);
  same(read, expected(row, false));
  const actual = observe(read, log); same(actual, expected(row, false));
  const printed = String(actual); same(printed, row.text); console.log(printed);
}
assert.compareArray(log, branches.concat(branches));
