/*---
description: Object.assign replaces a statically numeric tuple element without changing the original tuple identity, length or adjacent boolean.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-unsound-object-assign, ts-objects, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// The original numeric tuple remains the read route after Object.assign; node reads each actual replacement and retains the true neighbor and length two.
const token = { id: 1 };
const entries: [unknown, string][] = [["tail", "string"], [false, "boolean"], [0n, "bigint"],
  [undefined, "undefined"], [null, "object"], [-0, "number"], [NaN, "number"], [token, "object"]];
for (const [payload, kind] of entries) {
  const target: [number, boolean] = [1, true];
  const returned = Object.assign(target, { 0: payload });
  const value: number = target[0];
  assert.sameValue(returned, target); assert.sameValue(typeof returned, "object");
  assert.sameValue(value, payload); assert.sameValue(typeof value, kind);
  assert.sameValue(target[1], true); assert.sameValue(typeof target[1], "boolean");
  assert.sameValue(target.length, 2); assert.sameValue(typeof target.length, "number");
}
