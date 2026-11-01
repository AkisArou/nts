/*---
description: A generic parse helper preserves both numeric and string payloads in matching generic envelopes.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-generics, ts-objects, ts-unions, ts-numbers, ts-strings, ts-tuples]
---*/
// Parse matching envelopes through number and string generic instantiations; node preserves the payload kind, value and root key order.
interface JsonBox<T> { payload: T; ready: boolean; }
function readBox<T>(text: string): JsonBox<T> {
  const value: JsonBox<T> = JSON.parse(text); return value;
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
