/*---
description: "A type inferred from a function parameter carries mixed primitive and reference values through a declared tuple element. The control uses the written-out parameter union."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-type-aliases, ts-functions, ts-tuples, ts-arrays, ts-iteration, ts-unions, ts-unknown, ts-typeof-operator]
---*/
// infer extracts a parameter type before tuple storage; node preserves the actual primitive or reference and its runtime kind.
type Marker = { id: number };
function parameterSource(value: number | string | Marker): void { }
type RoutedValue = number | string | Marker;
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
