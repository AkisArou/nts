/*---
description: A returned closure keeps a valid narrowing of an unchanged union parameter.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-unions, ts-narrowing, ts-closures, ts-arrow-functions, ts-function-types, ts-numbers, ts-strings]
---*/
// An unchanged number|string parameter is narrowed before closure creation; later calls keep the chosen branch, exact value and member-only operation.
interface NarrowRow { kind: string; num: number; str: string; }
const rows: NarrowRow[] = [{ kind: "number", num: -0, str: "" }, { kind: "string", num: NaN, str: "" },
  { kind: "number", num: NaN, str: "tail" }, { kind: "string", num: -0, str: "tail" }];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function later(value: number | string, expected: NarrowRow): () => void {
  if (typeof value === "number") {
    log.push("create:number"); return () => { log.push("call:number"); same(value, expected.num); same(value.toString(), expected.num.toString()); };
  }
  log.push("create:string"); return () => { log.push("call:string"); same(value, expected.str); same(value.length, expected.str.length); };
}
const readers: (() => void)[] = [];
for (const row of rows) readers.push(later(row.kind === "number" ? row.num : row.str, row));
for (const read of readers) read();
assert.compareArray(log, ["create:number", "create:string", "create:number", "create:string", "call:number", "call:string", "call:number", "call:string"]);
