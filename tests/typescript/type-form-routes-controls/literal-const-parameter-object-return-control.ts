/*---
description: "A const type parameter retains a literal object member in its returned type while wider aliases still replace both returned properties. The control writes out the inferred readonly literal object return and parameter."
features: [ts-type-form-routes, ts-type-form-route-literal, ts-functions, ts-readonly, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-literal-types]
---*/
// Const inference travels through a generic return; node exposes the actual replacements even when the return still claims ready.
function retain(value: { readonly kind: "ready"; readonly amount: number }): { readonly kind: "ready"; readonly amount: number } { return value; }
for (const amount of [-0, NaN, 8.5]) {
  const route = retain({ kind: "ready", amount });
  const literal: "ready" = route.kind;
  assert.sameValue(literal, "ready"); assert.sameValue(typeof literal, "string");
  assert.sameValue(route.amount, amount); assert.sameValue(typeof route.amount, "number");
  const writable: { kind: unknown; amount: unknown } = route;
  writable.kind = amount; writable.amount = false;
  const claimed: "ready" = route.kind;
  assert.sameValue(Object.is(claimed, amount), true); assert.sameValue(typeof claimed, "number");
  assert.sameValue(Object.is(route.amount, false), true); assert.sameValue(typeof route.amount, "boolean");
  assert.sameValue(writable, route);
}
