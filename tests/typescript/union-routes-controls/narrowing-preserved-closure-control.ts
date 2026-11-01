/*---
description: Control for narrowing-preserved-closure; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-closures, ts-arrow-functions, ts-function-types, ts-numbers, ts-strings]
---*/
// Capture a copied kind record and read its concrete selected field in the same deferred closures and call order.
interface NarrowRow { kind: string; num: number; str: string; }
const rows: NarrowRow[] = [{ kind: "number", num: -0, str: "" }, { kind: "string", num: NaN, str: "" },
  { kind: "number", num: NaN, str: "tail" }, { kind: "string", num: -0, str: "tail" }];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function later(value: NarrowRow, expected: NarrowRow): () => void {
  if (value.kind === "number") {
    log.push("create:number"); return () => { log.push("call:number"); same(value.num, expected.num); same(value.num.toString(), expected.num.toString()); };
  }
  log.push("create:string"); return () => { log.push("call:string"); same(value.str, expected.str); same(value.str.length, expected.str.length); };
}
const readers: (() => void)[] = [];
for (const row of rows) readers.push(later({ kind: row.kind, num: row.num, str: row.str }, row));
for (const read of readers) read();
assert.compareArray(log, ["create:number", "create:string", "create:number", "create:string", "call:number", "call:string", "call:number", "call:string"]);
