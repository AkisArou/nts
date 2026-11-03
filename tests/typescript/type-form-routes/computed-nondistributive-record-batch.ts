/*---
description: "A tuple-wrapped conditional keeps a union together in one mixed batch stored in a Record field."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-conditional-types, ts-type-aliases, ts-generics, ts-tuples, ts-record, ts-arrays, ts-iteration, ts-unions, ts-typeof-operator]
---*/
// A tuple-wrapped conditional crosses a Record field without distribution; node retains one batch containing both runtime kinds.
type Batch<T> = [T] extends [string] ? { kind: "text"; items: T[] } : { kind: "mixed"; items: T[] };
type MixedBatch = Batch<number | string>;
for (const amount of [-0, NaN, 6.5]) {
  const route: Record<"selected", MixedBatch> = { selected: { kind: "mixed", items: [amount, "tag", amount] } };
  const tag: "mixed" = route.selected.kind;
  assert.sameValue(tag, "mixed"); assert.sameValue(typeof tag, "string");
  assert.sameValue(route.selected.items.length, 3);
  assert.sameValue(route.selected.items[0], amount); assert.sameValue(typeof route.selected.items[0], "number");
  assert.sameValue(route.selected.items[1], "tag"); assert.sameValue(typeof route.selected.items[1], "string");
  assert.sameValue(route.selected.items[2], amount); assert.sameValue(typeof route.selected.items[2], "number");
  route.selected.items[1] = -0;
  assert.sameValue(route.selected.items[1], -0); assert.sameValue(typeof route.selected.items[1], "number");
}
