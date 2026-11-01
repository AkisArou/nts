/*---
description: Control for narrowing-typeof-returned-union; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Return a copied kind record with separate number, string and undefined fields; read only the field selected by kind.
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
function deliver(row: NarrowRow): NarrowRow { return { kind: row.kind, num: row.num, str: row.str, absent: row.absent }; }
function inspect(value: NarrowRow, expected: NarrowRow): void {
  if (value.kind === "number") { log.push("number"); same(value.num, expected.num); }
  else if (value.kind === "string") { log.push("string"); same(value.str, expected.str); }
  else { log.push("undefined"); same(value.absent, expected.absent); }
}
for (const row of rows) inspect(deliver(row), row);
assert.compareArray(log, ["number", "string", "undefined", "number", "string", "undefined"]);
