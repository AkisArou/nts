/*---
description: Control for widening-generic-stored-result; write the union as an explicit member record.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-numbers, ts-strings, ts-objects, ts-tuples, ts-generics, ts-arrow-functions, ts-closures, ts-function-types]
---*/
// Instantiate the same generic capture with the explicit member record and branch on kind after the same deferred field return.
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
function postpone<T>(value: T): () => { value: T } { const saved = { value }; return () => saved; }
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const inputs: ExplicitUnion[] = [member("object", n, text, point), member("number", n, text, point), member("string", n, text, point)], log: string[] = [];
  const readers = inputs.map(value => postpone<ExplicitUnion>(value));
  same(readers.length, 3);
  for (const read of readers) observe(read().value, n, text, point, log);
  assert.compareArray(log, ["object", "number", "string"]);
}
