/*---
description: "Control for computed-infer-tuple-typed-parameter; A type inferred from a fixed middle tuple slot preserves mixed values and alias writes through a declared parameter."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-type-aliases, ts-tuples, ts-unions, ts-narrowing, ts-objects, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// infer selects the middle member of SourceTuple before forward receives it; node preserves each payload kind, reference identity and the later marker write. The control writes out the middle member union while keeping the source tuple and parameter route.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
type Marker = { id: number };
type SourceTuple = [string, number | bigint | Marker | undefined, boolean];
type RoutedValue = number | bigint | Marker | undefined;
function forward(value: RoutedValue): RoutedValue { return value; }
const marker: Marker = { id: 7 };
const values: RoutedValue[] = [-0, NaN, 0n, 9007199254740993n, undefined, marker];
for (const value of values) {
  const source: SourceTuple = ["left", value, true];
  const result = forward(source[1]);
  same(result, value); same(source[0], "left"); same(source[2], true); same(source.length, 3);
  if (typeof result === "object") { result.id = -0; same(marker.id, -0); }
}
