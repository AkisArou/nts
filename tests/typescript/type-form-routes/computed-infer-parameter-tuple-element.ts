/*---
description: "A type inferred from a function parameter carries mixed primitive and reference values through a declared tuple element."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-infer, ts-conditional-types, ts-generics, ts-type-aliases, ts-typeof-type, ts-functions, ts-tuples, ts-arrays, ts-iteration, ts-unions, ts-unknown, ts-typeof-operator]
---*/
// infer extracts a parameter type before tuple storage; node preserves the actual primitive or reference and its runtime kind.
type Marker = { id: number };
function parameterSource(value: number | string | Marker): void { }
type Parameter<F> = F extends (value: infer P) => void ? P : never;
type RoutedValue = Parameter<typeof parameterSource>;
const marker: Marker = { id: 7 };
const rows: [RoutedValue, unknown, string][] = [[-0, -0, "number"], [NaN, NaN, "number"], ["", "", "string"], [marker, marker, "object"]];
for (const [input, expected, kind] of rows) {
  const route: [RoutedValue] = [input];
  const value: RoutedValue = route[0];
  assert.sameValue(value, expected); assert.sameValue(typeof value, kind);
  assert.sameValue(route.length, 1); assert.sameValue(Array.isArray(route), true);
  if (typeof value === "object") {
    value.id = -0;
    assert.sameValue(marker.id, -0); assert.sameValue(typeof marker.id, "number");
  }
}
