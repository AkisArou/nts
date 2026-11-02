/*---
description: A four-parameter function array carries fixed-plus-rest implementations with exact fresh three-element tails.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-rest-parameters, ts-tuples, ts-objects, ts-null-undefined]
---*/
// An array of four-parameter function types carries one-fixed-plus-rest implementations; node excludes the fixed slot from fresh tails.
type ParamValue = number | string | boolean | null | undefined | { mark: number };

type ParamInput = [ParamValue, ParamValue, ParamValue, ParamValue];
interface ParamResult { fixed: ParamValue; tail: ParamValue[]; }
type ParamReader = (first: ParamValue, second: ParamValue, third: ParamValue, fourth: ParamValue) => ParamResult;
function declared(fixed: ParamValue, ...tail: ParamValue[]): ParamResult { return { fixed, tail }; }
const expression = function (fixed: ParamValue, ...tail: ParamValue[]): ParamResult { return { fixed, tail }; };
const readers: ParamReader[] = [declared, expression];
function invoke(reader: ParamReader, input: ParamInput): ParamResult { return reader(...input); }
const identity = { mark: 23 };
const rows: { input: ParamInput; tail: ParamValue[] }[] = [
  { input: [identity, -0, NaN, undefined], tail: [-0, NaN, undefined] },
  { input: [null, identity, "tail", false], tail: [identity, "tail", false] },
  { input: [17, 0, "", null], tail: [0, "", null] }
];
for (const reader of readers) for (const row of rows) {
  const original = row.input.slice(), first = invoke(reader, row.input), second = invoke(reader, row.input);
  assert.sameValue(first.fixed, row.input[0]); assert.sameValue(second.fixed, row.input[0]);
  assert.sameValue(Array.isArray(first.tail), true); assert.sameValue(first.tail === second.tail, false);
  assert.compareArray(first.tail, row.tail); assert.compareArray(second.tail, row.tail);
  first.tail.push("extra"); assert.compareArray(first.tail, [...row.tail, "extra"]); assert.compareArray(second.tail, row.tail); assert.compareArray(row.input, original);
}
