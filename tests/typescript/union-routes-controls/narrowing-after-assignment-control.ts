/*---
description: Control for narrowing-after-assignment; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-numbers, ts-strings]
---*/
// Replace the local with a record whose kind is explicitly changed and whose separate number/string payloads remain exact.
interface NarrowRow { kind: string; num: number; str: string; }
const rows: NarrowRow[] = [{ kind: "number", num: -0, str: "" }, { kind: "string", num: NaN, str: "" },
  { kind: "number", num: NaN, str: "tail" }, { kind: "string", num: -0, str: "tail" }];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: NarrowRow, expected: NarrowRow): void {
  if (value.kind === "number") { log.push("number"); same(value.num, expected.num); }
  else { log.push("string"); same(value.str, expected.str); }
}
for (const row of rows) {
  let value: NarrowRow = { kind: row.kind, num: row.num, str: row.str };
  if (value.kind === "number") { log.push("before:number"); same(value.num, row.num); value = { kind: "string", num: row.num, str: row.str }; }
  else { log.push("before:string"); same(value.str, row.str); value = { kind: "number", num: row.num, str: row.str }; }
  inspect(value, row);
}
assert.compareArray(log, ["before:number", "string", "before:string", "number", "before:number", "string", "before:string", "number"]);
