/*---
description: A typed local changes union member after an active narrowing before a typed read.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-unions, ts-narrowing, ts-numbers, ts-strings]
---*/
// A number|string local is narrowed in its own scope, assigned the other member inside that branch and read again; node keeps the new branch and exact payload.
interface NarrowRow { kind: string; num: number; str: string; }
const rows: NarrowRow[] = [{ kind: "number", num: -0, str: "" }, { kind: "string", num: NaN, str: "" },
  { kind: "number", num: NaN, str: "tail" }, { kind: "string", num: -0, str: "tail" }];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: number | string, expected: NarrowRow): void {
  if (typeof value === "number") { log.push("number"); same(value, expected.num); }
  else { log.push("string"); same(value, expected.str); }
}
for (const row of rows) {
  let value: number | string = row.kind === "number" ? row.num : row.str;
  if (typeof value === "number") { log.push("before:number"); same(value, row.num); value = row.str; }
  else { log.push("before:string"); same(value, row.str); value = row.num; }
  inspect(value, row);
}
assert.compareArray(log, ["before:number", "string", "before:string", "number", "before:number", "string", "before:string", "number"]);
