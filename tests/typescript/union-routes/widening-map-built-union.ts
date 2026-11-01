/*---
description: A typed map callback builds a union array from concrete numeric source elements.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-unions, ts-narrowing, ts-numbers, ts-strings, ts-objects, ts-tuples, ts-arrow-functions]
---*/
// A number[] map callback returns number, string or object by index; Node keeps the exact newly built union members and callback order.
type WidenPoint = { id: number };
type Payload = number | string | WidenPoint;
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: Payload, n: number, text: string, point: WidenPoint, log: string[]): void {
  if (typeof value === "number") { log.push("number"); same(value, n); }
  else if (typeof value === "string") { log.push("string"); same(value, text); }
  else if (typeof value === "object" && value !== null) { log.push("object"); same(value, point); same(value.id, n); }
  else throw new Test262Error("unexpected union member");
}
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const source: number[] = [n, 7, n], visits: number[] = [], log: string[] = [];
  const built: Payload[] = source.map((value, index): Payload => {
    visits.push(index); same(value, index === 1 ? 7 : n);
    return index === 0 ? value : index === 1 ? text : point;
  });
  same(built.length, 3); assert.compareArray(visits, [0, 1, 2]);
  for (const value of built) observe(value, n, text, point, log);
  assert.compareArray(log, ["number", "string", "object"]);
}
