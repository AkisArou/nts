/*---
description: Control for widening-map-built-union; write the union as an explicit member record.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-numbers, ts-strings, ts-objects, ts-tuples, ts-arrow-functions]
---*/
// Keep the numeric source and callback visits, returning explicit member records from the callback and branching on kind when reading the new array.
type WidenPoint = { id: number };
interface ExplicitUnion { kind: string; num: number; str: string; ref: WidenPoint; }
function member(kind: string, n: number, text: string, point: WidenPoint): ExplicitUnion { return { kind, num: n, str: text, ref: point }; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: ExplicitUnion, n: number, text: string, point: WidenPoint, log: string[]): void {
  if (value.kind === "number") { log.push("number"); same(value.num, n); }
  else if (value.kind === "string") { log.push("string"); same(value.str, text); }
  else if (value.kind === "object") { log.push("object"); same(value.ref, point); same(value.ref.id, n); }
  else throw new Test262Error("unexpected union member");
}
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const source: number[] = [n, 7, n], visits: number[] = [], log: string[] = [];
  const built: ExplicitUnion[] = source.map((value, index): ExplicitUnion => {
    visits.push(index); same(value, index === 1 ? 7 : n);
    return member(index === 0 ? "number" : index === 1 ? "string" : "object", value, text, point);
  });
  same(built.length, 3); assert.compareArray(visits, [0, 1, 2]);
  for (const value of built) observe(value, n, text, point, log);
  assert.compareArray(log, ["number", "string", "object"]);
}
