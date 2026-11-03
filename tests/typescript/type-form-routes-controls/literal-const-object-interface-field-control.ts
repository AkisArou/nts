/*---
description: "A const-asserted object retains writes through a widened alias when its literal-valued properties are read from an interface field. The control writes out the readonly literal property annotation."
features: [ts-type-form-routes, ts-type-form-route-literal, ts-interfaces, ts-readonly, ts-objects, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-literal-types, ts-structural-typing]
---*/
// as const crosses an interface field; node reads each actual replacement, not the original literal or a frozen object.
interface LiteralHolder { value: { readonly amount: 1; readonly label: "initial" } }
const samples: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { id: 3 }];
for (const sample of samples) {
  const value: { readonly amount: 1; readonly label: "initial" } = { amount: 1, label: "initial" };
  const route: LiteralHolder = { value };
  const writable: { amount: unknown; label: unknown } = route.value;
  assert.sameValue(route.value, value); assert.sameValue(typeof route.value, "object");
  assert.sameValue(route.value.amount, 1); assert.sameValue(typeof route.value.amount, "number");
  writable.amount = sample; writable.label = sample;
  const amount: 1 = route.value.amount, label: "initial" = route.value.label;
  assert.sameValue(amount, sample); assert.sameValue(typeof amount, typeof sample);
  assert.sameValue(label, sample); assert.sameValue(typeof label, typeof sample);
  assert.sameValue(writable, value);
}
