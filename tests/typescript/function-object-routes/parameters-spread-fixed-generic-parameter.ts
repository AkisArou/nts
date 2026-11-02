/*---
description: A generic helper spreads a heterogeneous typed tuple into fixed parameters without changing order or payload identity.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-generics, ts-tuples, ts-spread, ts-objects, ts-strings, ts-numbers]
---*/
// A generic callback-and-tuple parameter route spreads three fixed arguments; node preserves their order and the payload identity.
interface ParamBox { mark: number; }
type ParamInput = [number, string, ParamBox];
type ParamReader = (first: number, second: string, third: ParamBox) => unknown[];
function declared(first: number, second: string, third: ParamBox): unknown[] { return [first, second, third]; }
const expression = function (first: number, second: string, third: ParamBox): unknown[] { return [first, second, third]; };
const literal = { read(first: number, second: string, third: ParamBox): unknown[] { return [first, second, third]; } };
function invoke<A, B, C, R>(reader: (first: A, second: B, third: C) => R, input: [A, B, C]): R { return reader(...input); }
const readers: ParamReader[] = [declared, expression, literal.read];
const firstIdentity = { mark: 23 }, secondIdentity = { mark: 71 };
const inputs: ParamInput[] = [[-0, "", firstIdentity], [NaN, "中", secondIdentity], [17, "tail", firstIdentity]];
for (const reader of readers) for (const input of inputs) {
  const original = input.slice(), actual = invoke(reader, input);
  assert.compareArray(actual, input); assert.sameValue(actual === input, false);
  actual[0] = 29; assert.compareArray(actual, [29, input[1], input[2]]); assert.compareArray(input, original);
}
