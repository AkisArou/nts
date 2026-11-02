/*---
description: A one-parameter function return hides an optional second parameter and yields fresh empty rest arrays.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-rest-parameters, ts-optional-parameters, ts-tuples, ts-null-undefined]
---*/
// A one-parameter return carries wider implementations; node leaves the hidden second parameter undefined and makes fresh empty tails.
type ParamValue = number | string | boolean | null | undefined | { mark: number };

interface ParamResult { first: ParamValue; second: ParamValue; tail: ParamValue[]; }
type ParamReader = (first?: ParamValue) => ParamResult;
function declared(first?: ParamValue, second?: ParamValue, ...tail: ParamValue[]): ParamResult { return { first, second, tail }; }
const expression = function (first?: ParamValue, second?: ParamValue, ...tail: ParamValue[]): ParamResult { return { first, second, tail }; };
function choose(alternate: boolean): ParamReader { return alternate ? expression : declared; }
function invoke(reader: ParamReader, input: [ParamValue?]): ParamResult { return reader(...input); }
const identity = { mark: 23 }; const inputs: [ParamValue?][] = [[], [undefined], [null], [-0], [NaN], [identity]];
for (const alternate of [false, true]) for (const input of inputs) {
  const reader = choose(alternate), first = invoke(reader, input), second = invoke(reader, input);
  assert.sameValue(first.first, input[0]); assert.sameValue(second.first, input[0]);
  assert.sameValue(first.second, undefined); assert.sameValue(second.second, undefined);
  assert.compareArray(first.tail, []); assert.compareArray(second.tail, []);
  assert.sameValue(Array.isArray(first.tail), true); assert.sameValue(first.tail === second.tail, false);
  first.tail.push("extra"); assert.compareArray(first.tail, ["extra"]); assert.compareArray(second.tail, []);
}
