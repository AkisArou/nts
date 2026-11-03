/*---
description: "A const-asserted heterogeneous tuple returned under its literal tuple type exposes writes through widened named index properties. The control writes out the readonly literal tuple annotation."
features: [ts-type-form-routes, ts-type-form-route-literal, ts-functions, ts-readonly, ts-tuples, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-literal-types]
---*/
// as const travels through a declared tuple return; node returns the same mutable tuple and its replacement slot values.
function makeTuple(): readonly [0, "start", false] {
  const tuple: readonly [0, "start", false] = [0, "start", false];
  return tuple;
}
const samples: unknown[] = [undefined, false, -0, NaN, 0n, "", { id: 5 }];
for (const sample of samples) {
  const route = makeTuple();
  const writable: { 0: unknown; 1: unknown; 2: unknown } = route;
  writable[0] = sample; writable[1] = sample; writable[2] = sample;
  const first: 0 = route[0], second: "start" = route[1], third: false = route[2];
  assert.sameValue(first, sample); assert.sameValue(typeof first, typeof sample);
  assert.sameValue(second, sample); assert.sameValue(typeof second, typeof sample);
  assert.sameValue(third, sample); assert.sameValue(typeof third, typeof sample);
  assert.sameValue(route.length, 3); assert.sameValue(Array.isArray(route), true);
  assert.sameValue(writable, route);
}
