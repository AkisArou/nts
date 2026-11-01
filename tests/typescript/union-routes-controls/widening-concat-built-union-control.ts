/*---
description: Control for widening-concat-built-union; write the union as an explicit member record.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-numbers, ts-strings, ts-bigint, ts-objects, ts-tuples]
---*/
// Concatenate explicit member records with separate number, string and bigint fields; preserve sources, lengths, ordering and concrete payload checks.
interface ExplicitUnion { kind: string; num: number; str: string; big: bigint; }
function member(kind: string, n: number, text: string, big: bigint): ExplicitUnion { return { kind, num: n, str: text, big: big }; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: ExplicitUnion, n: number, text: string, big: bigint, log: string[]): void {
  if (value.kind === "number") { log.push("number"); same(value.num, n); }
  else if (value.kind === "string") { log.push("string"); same(value.str, text); }
  else if (value.kind === "bigint") { log.push("bigint"); same(value.big, big); }
  else throw new Test262Error("unexpected union member");
}
const rounds: [number, string, bigint][] = [[-0, "", 0n], [NaN, "tail", -1n], [0, "0", 9007199254740993n]];
for (const [n, text, big] of rounds) {
  const left: ExplicitUnion[] = [member("number", n, text, big), member("string", n, text, big)], right: ExplicitUnion[] = [member("bigint", n, text, big)], log: string[] = [];
  const built: ExplicitUnion[] = left.concat(right, [member("number", n, text, big)]);
  same(built.length, 4); same(built === left, false); same(left.length, 2); same(right.length, 1);
  for (const value of built) observe(value, n, text, big, log);
  assert.compareArray(log, ["number", "string", "bigint", "number"]);
}
