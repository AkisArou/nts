/*---
description: Filtering a declared union array preserves undefined, falsy primitives and references while dropping null.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-unions, ts-narrowing, ts-numbers, ts-strings, ts-null-undefined, ts-objects, ts-tuples, ts-arrow-functions]
---*/
// A union array is filtered by a null test, then narrowed again; Node retains undefined, signed zero, NaN, empty text and the same object in order.
type WidenPoint = { id: number };
type Payload = number | string | null | undefined | WidenPoint;
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: Payload, n: number, text: string, point: WidenPoint, log: string[]): void {
  if (typeof value === "number") { log.push("number"); same(value, n); }
  else if (typeof value === "string") { log.push("string"); same(value, text); }
  else if (value === null) { log.push("null"); same(value, null); }
  else if (value === undefined) { log.push("undefined"); same(value, undefined); }
  else if (typeof value === "object" && value !== null) { log.push("object"); same(value, point); same(value.id, n); }
  else throw new Test262Error("unexpected union member");
}
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const source: Payload[] = [null, n, undefined, text, point, null], log: string[] = [], decisions: string[] = [];
  const built: Payload[] = source.filter(value => {
    observe(value, n, text, point, log);
    if (value === null) { decisions.push("drop"); return false; }
    decisions.push("keep"); return true;
  });
  same(built.length, 4);
  for (const value of built) observe(value, n, text, point, log);
  assert.compareArray(decisions, ["drop", "keep", "keep", "keep", "keep", "drop"]);
  assert.compareArray(log, ["null", "number", "undefined", "string", "object", "null", "number", "undefined", "string", "object"]);
}
