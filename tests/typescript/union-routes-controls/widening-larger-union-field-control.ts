/*---
description: Control for widening-larger-union-field; write the union as an explicit member record.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-numbers, ts-strings, ts-null-undefined, ts-objects, ts-tuples]
---*/
// Construct member records directly, retain the same fields and input order, and select concrete payloads by kind instead of widening or narrowing a union.
type WidenPoint = { id: number };
interface ExplicitUnion { kind: string; num: number; str: string; bool: boolean; nil: null; undef: undefined; ref: WidenPoint; }
function member(kind: string, n: number, text: string, flag: boolean, point: WidenPoint): ExplicitUnion { return { kind, num: n, str: text, bool: flag, nil: null, undef: undefined, ref: point }; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: ExplicitUnion, n: number, text: string, flag: boolean, point: WidenPoint, log: string[]): void {
  if (value.kind === "number") { log.push("number"); same(value.num, n); }
  else if (value.kind === "string") { log.push("string"); same(value.str, text); }
  else if (value.kind === "boolean") { log.push("boolean"); same(value.bool, flag); }
  else if (value.kind === "null") { log.push("null"); same(value.nil, null); }
  else if (value.kind === "undefined") { log.push("undefined"); same(value.undef, undefined); }
  else if (value.kind === "object") { log.push("object"); same(value.ref, point); same(value.ref.id, n); }
  else throw new Test262Error("unexpected union member");
}
function retain(value: ExplicitUnion): { value: ExplicitUnion } { return { value }; }
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const flag = text.length > 0, log: string[] = [];
  const incoming: ExplicitUnion[] = [member("number", n, text, flag, point), member("string", n, text, flag, point), member("object", n, text, flag, point)];
  const stored: { value: ExplicitUnion }[] = [];
  for (const value of incoming) stored.push(retain(value));
  stored.push(retain(member("boolean", n, text, flag, point)), retain(member("null", n, text, flag, point)), retain(member("undefined", n, text, flag, point)));
  same(stored.length, 6);
  for (const entry of stored) observe(entry.value, n, text, flag, point, log);
  assert.compareArray(log, ["number", "string", "object", "boolean", "null", "undefined"]);
}
