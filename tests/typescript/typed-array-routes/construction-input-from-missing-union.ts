/*---
description: "Missing array-like entries become undefined before integer zero or floating NaN conversion."
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-null-undefined, ts-arrow-functions, ts-closures, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-tuples, ts-destructuring, ts-strings]
---*/

// Missing array-like entries become undefined before integer zero or floating NaN conversion. Route: a discriminated union choosing integer and floating destinations.
// Node prints construction-input-from-missing-union:ok.
type Samples = Uint8Array | Float64Array;
type MissingInput = { kind: "integer"; values: ArrayLike<number> } | { kind: "real"; values: ArrayLike<number> };
function build(input: MissingInput, visits: (number | undefined)[]): Samples {
  const mapper = (value: number, index: number): number => { visits.push(value); return value; };
  if (input.kind === "integer") return Uint8Array.from(input.values, mapper);
  return Float64Array.from(input.values, mapper);
}
const rows: readonly [MissingInput, readonly number[], readonly (number | undefined)[]][] = [
  [{ kind: "integer", values: { length: 2 } }, [0, 0], [undefined, undefined]], [{ kind: "real", values: { length: 2 } }, [NaN, NaN], [undefined, undefined]],
  [{ kind: "integer", values: { length: 3, 0: 5, 2: -1 } }, [5, 0, 255], [5, undefined, -1]],
  [{ kind: "real", values: { length: 3, 0: 5, 2: -1 } }, [5, NaN, -1], [5, undefined, -1]]
];
for (const [input, expected, expectedVisits] of rows) {
  const visits: (number | undefined)[] = [], result = build(input, visits), actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.compareArray(visits, expectedVisits);
}
console.log("construction-input-from-missing-union:ok");
