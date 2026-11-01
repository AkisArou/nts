/*---
description: Control for widening-conditional-result; write the union as an explicit member record.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-numbers, ts-bigint, ts-objects, ts-tuples]
---*/
// Use the same condition to choose a kind in one record with separate number, bigint and reference fields, then retain and read that record.
type WidenPoint = { id: number };
interface ExplicitUnion { kind: string; num: number; big: bigint; ref: WidenPoint; }
function member(kind: string, n: number, big: bigint, point: WidenPoint): ExplicitUnion { return { kind, num: n, big: big, ref: point }; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: ExplicitUnion, n: number, big: bigint, point: WidenPoint, log: string[]): void {
  if (value.kind === "number") { log.push("number"); same(value.num, n); }
  else if (value.kind === "bigint") { log.push("bigint"); same(value.big, big); }
  else if (value.kind === "object") { log.push("object"); same(value.ref, point); same(value.ref.id, n); }
  else throw new Test262Error("unexpected union member");
}
const rounds: [number, bigint][] = [[-0, 0n], [NaN, -1n], [0, 9007199254740993n]];
for (const [n, big] of rounds) {
  const point = { id: n }, log: string[] = [];
  for (const mode of [2, 0, 1, 0]) {
    const value: ExplicitUnion = member(mode === 0 ? "number" : mode === 1 ? "bigint" : "object", n, big, point);
    const stored: { value: ExplicitUnion } = { value };
    observe(stored.value, n, big, point, log);
  }
  assert.compareArray(log, ["object", "number", "bigint", "number"]);
}
