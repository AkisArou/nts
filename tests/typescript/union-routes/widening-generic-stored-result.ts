/*---
description: A union-valued generic argument is stored and returned later through a retained reader.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-unions, ts-narrowing, ts-numbers, ts-strings, ts-objects, ts-tuples, ts-generics, ts-arrow-functions, ts-closures, ts-function-types]
---*/
// One explicit union instantiation stores T in a captured field; later readers narrow the returned values and Node preserves their payloads and identities.
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
function postpone<T>(value: T): () => { value: T } { const saved = { value }; return () => saved; }
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const inputs: Payload[] = [point, n, text], log: string[] = [];
  const readers = inputs.map(value => postpone<Payload>(value));
  same(readers.length, 3);
  for (const read of readers) observe(read().value, n, text, point, log);
  assert.compareArray(log, ["object", "number", "string"]);
}
