/*---
description: "Missing array-like entries become undefined before integer zero or floating NaN conversion. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-null-undefined, ts-arrow-functions, ts-closures, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-tuples, ts-destructuring, ts-strings]
---*/

function localInteger(value: number, width: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** width, n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localFromUint8Array(values: ArrayLike<number>, mapper: (value: number, index: number) => number): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = localInteger(Number(mapper(values[i], i)), 8, false); return result; }
function localFromFloat64Array(values: ArrayLike<number>, mapper: (value: number, index: number) => number): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = Number(mapper(values[i], i)); return result; }
// Missing array-like entries become undefined before integer zero or floating NaN conversion. Route: a discriminated union choosing integer and floating destinations.
// Node prints construction-input-from-missing-union:ok.
type Samples = number[];
type MissingInput = { kind: "integer"; values: ArrayLike<number> } | { kind: "real"; values: ArrayLike<number> };
function build(input: MissingInput, visits: (number | undefined)[]): Samples {
  const mapper = (value: number, index: number): number => { visits.push(value); return value; };
  if (input.kind === "integer") return localFromUint8Array(input.values, mapper);
  return localFromFloat64Array(input.values, mapper);
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
