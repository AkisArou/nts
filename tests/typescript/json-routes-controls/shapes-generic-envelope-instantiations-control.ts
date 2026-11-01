/*---
description: Control for shapes-generic-envelope-instantiations; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-generics, ts-objects, ts-unions, ts-numbers, ts-strings, ts-tuples]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
interface JsonBox<T> { payload: T; ready: boolean; }
function readBox<T>(text: string): unknown {
  const value: unknown = JSON.parse(text); return value;
}
function check(text: string, expected: number | string): void {
  const value = typeof expected === "number" ? readBox<number>(text) : readBox<string>(text);
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("payload" in value) || !("ready" in value)) throw new Error("box");
  assert.compareArray(Object.keys(value), ["ready", "payload"]);
  assert.sameValue(typeof value.payload, typeof expected); assert.sameValue(Object.is(value.payload, expected), true);
  assert.sameValue(typeof value.ready, "boolean"); assert.sameValue(value.ready, true);
}
const inputs: [string, number | string][] = [
  ['{"ready":true,"payload":-0}', -0], ['{"ready":true,"payload":1.25e2}', 125],
  ['{"ready":true,"payload":"first"}', "first"], ['{"ready":true,"payload":"second"}', "second"],
];
for (const [text, expected] of inputs) check(text, expected);
