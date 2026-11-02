/*---
description: String-ID record control for A returned discriminated union keeps its unique-symbol payload across narrowing and writes.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-unions, ts-narrowing, ts-type-aliases, ts-literal-types, ts-typeof-operator]
---*/
// A Payload return carries numeric or text symbol data; node narrows the string discriminant while preserving the symbol key identity and payload.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const key = "token:payload", missing = "token:missing";
type Payload = { kind: "numeric"; fields: Record<string, number>; order: string[] } | { kind: "text"; fields: Record<string, string>; order: string[] };
function makeTarget(input: number | string): Payload { return typeof input === "number" ? { kind: "numeric", fields: { [key]: input }, order: [key] } : { kind: "text", fields: { [key]: input }, order: [key] }; }
function read(target: Payload): number | string { return target.fields[key]; }
function replace(target: Payload): void { if (target.kind === "numeric") target.fields[key] = 23; else target.fields[key] = "changed"; }
function has(target: Payload, token: string): boolean { return target.order.includes(token); }
function tokens(target: Payload): string[] { return target.order.slice(); }
function names(target: Payload): string[] { return Object.keys({ kind: target.kind }); }
const inputs: (number | string)[] = [-0, NaN, 17, "", "text"];
for (const input of inputs) {
  const target = makeTarget(input); same(read(target), input); same(target.kind, typeof input === "number" ? "numeric" : "text");
  same(has(target, key), true); same(has(target, missing), false); same(Object.is(key, missing), false);
  assert.compareArray(names(target), ["kind"]); assert.compareArray(tokens(target), [key]);
  replace(target); same(read(target), target.kind === "numeric" ? 23 : "changed"); same(has(target, missing), false);
  assert.compareArray(names(target), ["kind"]); assert.compareArray(tokens(target), [key]);
}
