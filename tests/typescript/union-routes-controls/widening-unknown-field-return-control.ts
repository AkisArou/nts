/*---
description: Control for widening-unknown-field-return; write the union as an explicit member record.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-numbers, ts-strings, ts-null-undefined, ts-objects, ts-tuples, ts-arrow-functions]
---*/
// Keep each erased field explicit as a member record from construction; kind selects its concrete field while the same storage and observations remain.
type WidenPoint = { id: number };
interface ExplicitUnion { kind: string; num: number; str: string; nil: null; undef: undefined; ref: WidenPoint; }
function member(kind: string, n: number, text: string, point: WidenPoint): ExplicitUnion { return { kind, num: n, str: text, nil: null, undef: undefined, ref: point }; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: ExplicitUnion, n: number, text: string, point: WidenPoint, log: string[]): void {
  if (value.kind === "number") { log.push("number"); same(value.num, n); }
  else if (value.kind === "string") { log.push("string"); same(value.str, text); }
  else if (value.kind === "null") { log.push("null"); same(value.nil, null); }
  else if (value.kind === "undefined") { log.push("undefined"); same(value.undef, undefined); }
  else if (value.kind === "object") { log.push("object"); same(value.ref, point); same(value.ref.id, n); }
  else throw new Test262Error("unexpected union member");
}
function conceal(value: ExplicitUnion): { value: ExplicitUnion } { return { value }; }
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const inputs: ExplicitUnion[] = [member("number", n, text, point), member("string", n, text, point), member("object", n, text, point), member("null", n, text, point), member("undefined", n, text, point)], log: string[] = [];
  const stored = inputs.map(value => conceal(value));
  same(stored.length, 5);
  for (const entry of stored) observe(entry.value, n, text, point, log);
  assert.compareArray(log, ["number", "string", "object", "null", "undefined"]);
}
