/*---
description: Concatenating bigint input into a wider primitive-union array retains exact members and order.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-unions, ts-narrowing, ts-numbers, ts-strings, ts-bigint, ts-tuples]
---*/
// A number|string|bigint array concatenates a bigint[] and another numeric member; Node keeps full bigint identity, signed zero and NaN in the new array.
type Payload = number | string | bigint;
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: Payload, n: number, text: string, big: bigint, log: string[]): void {
  if (typeof value === "number") { log.push("number"); same(value, n); }
  else if (typeof value === "string") { log.push("string"); same(value, text); }
  else if (typeof value === "bigint") { log.push("bigint"); same(value, big); }
  else throw new Test262Error("unexpected union member");
}
const rounds: [number, string, bigint][] = [[-0, "", 0n], [NaN, "tail", -1n], [0, "0", 9007199254740993n]];
for (const [n, text, big] of rounds) {
  const left: Payload[] = [n, text], right: bigint[] = [big], log: string[] = [];
  const built: Payload[] = left.concat(right, [n]);
  same(built.length, 4); same(built === left, false); same(left.length, 2); same(right.length, 1);
  for (const value of built) observe(value, n, text, big, log);
  assert.compareArray(log, ["number", "string", "bigint", "number"]);
}
