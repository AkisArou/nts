/*---
description: Defaulted functions selected from tuple slots read earlier initialized parameters with exact value and identity.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-default-parameters, ts-tuples, ts-objects, ts-null-undefined]
---*/
// Swapped tuple slots carry dependent defaults; node reads the earlier initialized binding, including null and object identities.
type ParamValue = number | string | boolean | null | undefined | { mark: number };

type ParamInput = [ParamValue, ParamValue?, ParamValue?];
type ParamReader = (first: ParamValue, second?: ParamValue, third?: ParamValue) => ParamValue[];
function declared(first: ParamValue, second: ParamValue = first, third: ParamValue = second): ParamValue[] { return [first, second, third]; }
const expression = function (first: ParamValue, second: ParamValue = first, third: ParamValue = second): ParamValue[] { return [first, second, third]; };
const orders: [ParamReader, ParamReader][] = [[declared, expression], [expression, declared]];
function invoke(reader: ParamReader, input: ParamInput): ParamValue[] { return reader(...input); }
const identity = { mark: 23 };
const rows: { input: ParamInput; expected: ParamValue[] }[] = [
  { input: [identity], expected: [identity, identity, identity] }, { input: [identity, null], expected: [identity, null, null] },
  { input: [-0, NaN], expected: [-0, NaN, NaN] }, { input: [NaN, undefined, -0], expected: [NaN, NaN, -0] },
  { input: [undefined, null, undefined], expected: [undefined, null, null] }
];
for (const order of orders) for (const reader of order) for (const row of rows) {
  assert.compareArray(invoke(reader, row.input), row.expected);
}
