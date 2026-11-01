/*---
description: A typed returned primitive union is narrowed by typeof without losing its exact payload.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-unions, ts-narrowing, ts-interfaces, ts-numbers, ts-strings, ts-null-undefined]
---*/
// A number|string|undefined return crosses a function boundary; typeof selects the member and node retains -0, NaN, empty text and undefined.
interface NarrowRow { kind: string; num: number; str: string; absent: undefined; }
const rows: NarrowRow[] = [
  { kind: "number", num: -0, str: "unused", absent: undefined }, { kind: "string", num: 91, str: "", absent: undefined },
  { kind: "undefined", num: 92, str: "stale", absent: undefined }, { kind: "number", num: NaN, str: "unused", absent: undefined },
  { kind: "string", num: 93, str: "tail", absent: undefined }, { kind: "undefined", num: 94, str: "stale", absent: undefined }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function deliver(row: NarrowRow): number | string | undefined {
  return row.kind === "number" ? row.num : row.kind === "string" ? row.str : row.absent;
}
function inspect(value: number | string | undefined, expected: NarrowRow): void {
  if (typeof value === "number") { log.push("number"); same(value, expected.num); }
  else if (typeof value === "string") { log.push("string"); same(value, expected.str); }
  else { log.push("undefined"); same(value, expected.absent); }
}
for (const row of rows) inspect(deliver(row), row);
assert.compareArray(log, ["number", "string", "undefined", "number", "string", "undefined"]);
