/*---
description: "FlatMap keeps non-array numeric string object null and undefined callback results as single elements through two interface callback implementations."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-interfaces, ts-readonly, ts-arrow-functions, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

// FlatMap keeps non-array numeric string object null and undefined callback results as single elements; route: two interface callback implementations.
// Node prints copies-flatmap-interface-scalar-results:ok.
type Scalar = number | string | { id: number } | null | undefined;
const marker: { id: number } = { id: 7 };
interface Mapper { convert(value: number): Scalar }
class Scaled implements Mapper { convert(value: number): Scalar { return value === 1 ? "one" : value * 3; } }
class Mixed implements Mapper { convert(value: number): Scalar { return value === 1 ? marker : value === 2 ? null : undefined; } }
const providers: readonly Mapper[] = [new Scaled(), new Mixed()];
const expected: readonly (readonly Scalar[])[] = [["one", 6, 9], [marker, null, undefined]];
const input: readonly number[] = [1, 2, 3];
for (let i = 0; i < providers.length; i++) {
  const provider: Mapper = providers[i];
  const result = input.flatMap<Scalar>((value: number) => provider.convert(value));
  assert.compareArray(result, expected[i]);
  assert.sameValue(result === input, false);
  assert.compareArray(input, [1, 2, 3]);
}
console.log("copies-flatmap-interface-scalar-results:ok");
