/*---
description: A returned discriminated union keeps its unique-symbol payload across narrowing and writes.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-unions, ts-narrowing, ts-type-aliases, ts-literal-types, ts-typeof-operator, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// A Payload return carries numeric or text symbol data; node narrows the string discriminant while preserving the symbol key identity and payload.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const key: unique symbol = Symbol("payload"), missing: unique symbol = Symbol("payload");
type Payload = { kind: "numeric"; [key]: number } | { kind: "text"; [key]: string };
function makeTarget(input: number | string): Payload { return typeof input === "number" ? { kind: "numeric", [key]: input } : { kind: "text", [key]: input }; }
function read(target: Payload): number | string { return target[key]; }
function replace(target: Payload): void { if (target.kind === "numeric") target[key] = 23; else target[key] = "changed"; }
function has(target: Payload, token: symbol): boolean { return token in target; }
function tokens(target: Payload): symbol[] { return Object.getOwnPropertySymbols(target); }
function names(target: Payload): string[] { return Object.keys(target); }
const inputs: (number | string)[] = [-0, NaN, 17, "", "text"];
for (const input of inputs) {
  const target = makeTarget(input); same(read(target), input); same(target.kind, typeof input === "number" ? "numeric" : "text");
  same(has(target, key), true); same(has(target, missing), false); same(Object.is(key, missing), false);
  assert.compareArray(names(target), ["kind"]); assert.compareArray(tokens(target), [key]);
  replace(target); same(read(target), target.kind === "numeric" ? 23 : "changed"); same(has(target, missing), false);
  assert.compareArray(names(target), ["kind"]); assert.compareArray(tokens(target), [key]);
}
