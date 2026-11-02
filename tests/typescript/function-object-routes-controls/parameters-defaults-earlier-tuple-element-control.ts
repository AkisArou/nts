/*---
description: Explicit parameter-list control for defaulted functions selected from tuple slots read earlier initialized parameters with exact value and identity.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-default-parameters, ts-tuples, ts-objects, ts-null-undefined]
---*/
// Swapped tuple slots carry explicit initializer steps; a later undefined slot reads its earlier initialized local.
type ParamValue = number | string | boolean | null | undefined | { mark: number };

type ParamInput = [ParamValue, ParamValue?, ParamValue?];
type ParamReader = (input: ParamInput) => ParamValue[];
function declared(input: ParamInput): ParamValue[] { const first = input[0], second = input[1] === undefined ? first : input[1], third = input[2] === undefined ? second : input[2]; return [first, second, third]; }
const expression = function (input: ParamInput): ParamValue[] { const first = input[0], second = input[1] === undefined ? first : input[1], third = input[2] === undefined ? second : input[2]; return [first, second, third]; };
const orders: [ParamReader, ParamReader][] = [[declared, expression], [expression, declared]];
function invoke(reader: ParamReader, input: ParamInput): ParamValue[] { return reader(input); }
const identity = { mark: 23 };
const rows: { input: ParamInput; expected: ParamValue[] }[] = [
  { input: [identity], expected: [identity, identity, identity] }, { input: [identity, null], expected: [identity, null, null] },
  { input: [-0, NaN], expected: [-0, NaN, NaN] }, { input: [NaN, undefined, -0], expected: [NaN, NaN, -0] },
  { input: [undefined, null, undefined], expected: [undefined, null, null] }
];
for (const order of orders) for (const reader of order) for (const row of rows) {
  assert.compareArray(invoke(reader, row.input), row.expected);
}
