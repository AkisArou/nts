/*---
description: "A function type inferred from a factory return remains callable with its identity and captured values intact in a Record."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-infer, ts-conditional-types, ts-generics, ts-type-aliases, ts-typeof-type, ts-functions, ts-arrow-functions, ts-record, ts-arrays, ts-iteration, ts-typeof-operator]
---*/
// infer extracts a callable return type before Record storage; node preserves the same function and each captured numeric result.
function makeCallback(value: number): () => number { return () => value; }
type Result<F> = F extends (...args: never[]) => infer R ? R : never;
type RoutedCallback = Result<typeof makeCallback>;
for (const amount of [-0, NaN, 5.5]) {
  const callback = makeCallback(amount);
  const route: Record<"callback", RoutedCallback> = { callback };
  const read: RoutedCallback = route.callback;
  assert.sameValue(read, callback); assert.sameValue(typeof read, "function");
  const first: number = read(), second: number = route.callback();
  assert.sameValue(first, amount); assert.sameValue(typeof first, "number");
  assert.sameValue(second, amount); assert.sameValue(typeof second, "number");
}
