/*---
description: "A satisfies expression checked against unknown-valued properties retains concrete member types and shared updates in a generic interface field."
features: [ts-type-form-routes, ts-type-form-route-literal, ts-satisfies, ts-interfaces, ts-generics, ts-record, ts-typeof-type, ts-typeof-operator, ts-arrays, ts-iteration, ts-unknown]
---*/
// satisfies crosses a generic interface field; node keeps concrete numeric/string members, extra data and subsequent writes.
interface SatisfiedHolder<T> { value: T }
for (const amount of [-0, NaN, 2.5]) {
  const value = { amount, text: "keep", extra: { amount } } satisfies Record<string, unknown>;
  const route: SatisfiedHolder<typeof value> = { value };
  const readNumber: number = route.value.amount;
  const readText: string = route.value.text.toUpperCase();
  assert.sameValue(readNumber, amount); assert.sameValue(typeof readNumber, "number");
  assert.sameValue(readText, "KEEP"); assert.sameValue(typeof readText, "string");
  assert.sameValue(route.value.extra, value.extra); assert.sameValue(typeof route.value.extra, "object");
  value.extra.amount = -0; value.text = "next";
  assert.sameValue(route.value.extra.amount, -0); assert.sameValue(typeof route.value.extra.amount, "number");
  assert.sameValue(route.value.text, "next"); assert.sameValue(typeof route.value.text, "string");
  assert.sameValue(route.value, value);
}
