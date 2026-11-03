/*---
description: "A function type inferred from a factory return remains callable with its identity and captured values intact in a Record. The control uses the written-out callable return type."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-type-aliases, ts-functions, ts-arrow-functions, ts-record, ts-arrays, ts-iteration, ts-typeof-operator]
---*/
// infer extracts a callable return type before Record storage; node preserves the same function and each captured numeric result.
function makeCallback(value: number): () => number { return () => value; }
type RoutedCallback = () => number;
for (const amount of [-0, NaN, 5.5]) {
  const callback = makeCallback(amount);
  const route: Record<"callback", RoutedCallback> = { callback };
  const read: RoutedCallback = route.callback;
  assert.sameValue(read, callback); assert.sameValue(typeof read, "function");
  const first: number = read(), second: number = route.callback();
  assert.sameValue(first, amount); assert.sameValue(typeof first, "number");
  assert.sameValue(second, amount); assert.sameValue(typeof second, "number");
}
