/*---
description: A conditional expression joins number, bigint and object values before a field read narrows them.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-unions, ts-narrowing, ts-numbers, ts-bigint, ts-objects, ts-tuples]
---*/
// A typed conditional result joins number, bigint and object members in one field; Node retains signed zero, NaN, full bigints and reference identity.
type WidenPoint = { id: number };
type Payload = number | bigint | WidenPoint;
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: Payload, n: number, big: bigint, point: WidenPoint, log: string[]): void {
  if (typeof value === "number") { log.push("number"); same(value, n); }
  else if (typeof value === "bigint") { log.push("bigint"); same(value, big); }
  else if (typeof value === "object" && value !== null) { log.push("object"); same(value, point); same(value.id, n); }
  else throw new Test262Error("unexpected union member");
}
const rounds: [number, bigint][] = [[-0, 0n], [NaN, -1n], [0, 9007199254740993n]];
for (const [n, big] of rounds) {
  const point = { id: n }, log: string[] = [];
  for (const mode of [2, 0, 1, 0]) {
    const value: Payload = mode === 0 ? n : mode === 1 ? big : point;
    const stored: { value: Payload } = { value };
    observe(stored.value, n, big, point, log);
  }
  assert.compareArray(log, ["object", "number", "bigint", "number"]);
}
