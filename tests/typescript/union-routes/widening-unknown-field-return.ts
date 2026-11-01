/*---
description: A union is stored in an unknown field and truthfully narrowed back to its original member.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-unions, ts-narrowing, ts-numbers, ts-strings, ts-null-undefined, ts-objects, ts-tuples, ts-arrow-functions, ts-unknown, ts-expressions]
---*/
// A declared union crosses an unknown-valued field before typeof, null and checked-property tests; Node retains exact primitives and object identity.
type WidenPoint = { id: number };
type Payload = number | string | null | undefined | WidenPoint;
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: unknown, n: number, text: string, point: WidenPoint, log: string[]): void {
  if (typeof value === "number") { log.push("number"); same(value, n); }
  else if (typeof value === "string") { log.push("string"); same(value, text); }
  else if (value === null) { log.push("null"); same(value, null); }
  else if (value === undefined) { log.push("undefined"); same(value, undefined); }
  else if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "number") { log.push("object"); same(value, point); same(value.id, n); }
  else throw new Test262Error("unexpected union member");
}
function conceal(value: Payload): { value: unknown } { return { value }; }
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const inputs: Payload[] = [n, text, point, null, undefined], log: string[] = [];
  const stored = inputs.map(value => conceal(value));
  same(stored.length, 5);
  for (const entry of stored) observe(entry.value, n, text, point, log);
  assert.compareArray(log, ["number", "string", "object", "null", "undefined"]);
}
