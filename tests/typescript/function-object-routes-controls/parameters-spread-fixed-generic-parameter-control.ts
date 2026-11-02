/*---
description: Explicit parameter-list control for a generic helper spreads a heterogeneous typed tuple into fixed parameters without changing order or payload identity.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-generics, ts-tuples, ts-spread, ts-objects, ts-strings, ts-numbers]
---*/
// A generic callback-and-tuple parameter route passes an explicit list whose three slots are read in order.
interface ParamBox { mark: number; }
type ParamInput = [number, string, ParamBox];
type ParamReader = (input: ParamInput) => unknown[];
function declared(input: ParamInput): unknown[] { return [input[0], input[1], input[2]]; }
const expression = function (input: ParamInput): unknown[] { return [input[0], input[1], input[2]]; };
const literal = { read(input: ParamInput): unknown[] { return [input[0], input[1], input[2]]; } };
function invoke<A, B, C, R>(reader: (input: [A, B, C]) => R, input: [A, B, C]): R { return reader(input); }
const readers: ParamReader[] = [declared, expression, literal.read];
const firstIdentity = { mark: 23 }, secondIdentity = { mark: 71 };
const inputs: ParamInput[] = [[-0, "", firstIdentity], [NaN, "中", secondIdentity], [17, "tail", firstIdentity]];
for (const reader of readers) for (const input of inputs) {
  const original = input.slice(), actual = invoke(reader, input);
  assert.compareArray(actual, input); assert.sameValue(actual === input, false);
  actual[0] = 29; assert.compareArray(actual, [29, input[1], input[2]]); assert.compareArray(input, original);
}
