/*---
description: Control for narrowing-reassigned-closure; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-closures, ts-arrow-functions, ts-function-types, ts-numbers, ts-strings]
---*/
// Capture and later replace a kind record, then select its current concrete field in the deferred call with the same before/after log.
interface NarrowRow { kind: string; num: number; str: string; }
const rows: NarrowRow[] = [{ kind: "number", num: -0, str: "" }, { kind: "string", num: NaN, str: "" },
  { kind: "number", num: NaN, str: "tail" }, { kind: "string", num: -0, str: "tail" }];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function later(value: NarrowRow, expected: NarrowRow): () => void {
  if (value.kind === "number") { log.push("before:number"); same(value.num, expected.num); }
  else { log.push("before:string"); same(value.str, expected.str); }
  const read = () => {
    if (value.kind === "number") { log.push("after:number"); same(value.num, expected.num); }
    else { log.push("after:string"); same(value.str, expected.str); }
  };
  value = { kind: expected.kind === "number" ? "string" : "number", num: expected.num, str: expected.str };
  return read;
}
const readers: (() => void)[] = [];
for (const row of rows) readers.push(later({ kind: row.kind, num: row.num, str: row.str }, row));
for (const read of readers) read();
assert.compareArray(log, ["before:number", "before:string", "before:number", "before:string", "after:string", "after:number", "after:string", "after:number"]);
