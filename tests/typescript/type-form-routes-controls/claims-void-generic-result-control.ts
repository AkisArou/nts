/*---
description: A generic result instantiated from a void callback preserves the returned object and its readable fields. The control uses honest types.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-generics, ts-interfaces, ts-functions, ts-function-types, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unknown, ts-narrowing, ts-typeof-operator]
---*/
// A void callback instantiates a generic result and then crosses unknown narrowing; node preserves the same returned record and its fields. The control states the possible value honestly.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
interface Payload { id: number; label: string; }
function invoke<T>(callback: () => T, log: unknown[]): T {
  log.push("invoke");
  const result = callback();
  log.push("result", result);
  return result;
}
for (const id of [-0, 2.5, 7]) {
  const payload: Payload = { id, label: "kept" }, log: unknown[] = [];
  const callback: () => Payload = () => { log.push("callback", payload); return payload; };
  const value: unknown = invoke(callback, log);
  same(value, payload);
  if (typeof value === "object" && value !== null && "id" in value && "label" in value) {
    same(value.id, id); same(value.label, "kept");
  } else throw new Test262Error("lost returned object");
  const expected: unknown[] = ["invoke", "callback", payload, "result", payload];
  assert.compareArray(log, expected);
  for (let index = 0; index < log.length; index++) same(log[index], expected[index]);
}
