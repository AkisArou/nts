/*---
description: A captured union is narrowed again after assignment changes its runtime member.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-unions, ts-narrowing, ts-closures, ts-arrow-functions, ts-function-types, ts-numbers, ts-strings]
---*/
// A number|string parameter is captured, then assigned the other member before invocation; node rechecks the current tag and returns no stale branch or payload.
interface NarrowRow { kind: string; num: number; str: string; }
const rows: NarrowRow[] = [{ kind: "number", num: -0, str: "" }, { kind: "string", num: NaN, str: "" },
  { kind: "number", num: NaN, str: "tail" }, { kind: "string", num: -0, str: "tail" }];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function later(value: number | string, expected: NarrowRow): () => void {
  if (typeof value === "number") { log.push("before:number"); same(value, expected.num); }
  else { log.push("before:string"); same(value, expected.str); }
  const read = () => {
    if (typeof value === "number") { log.push("after:number"); same(value, expected.num); }
    else { log.push("after:string"); same(value, expected.str); }
  };
  value = expected.kind === "number" ? expected.str : expected.num;
  return read;
}
const readers: (() => void)[] = [];
for (const row of rows) readers.push(later(row.kind === "number" ? row.num : row.str, row));
for (const read of readers) read();
assert.compareArray(log, ["before:number", "before:string", "before:number", "before:string", "after:string", "after:number", "after:string", "after:number"]);
