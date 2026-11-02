/*---
description: A function stored in a declared class field keeps formal parameters unchanged when incoming slots are written.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-class, ts-class-fields, ts-tuples, ts-optional-parameters]
---*/
// A class field carries functions that overwrite raw slots; node leaves formals and the caller array independent.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: IArguments): ArgSnapshot {
  const values: unknown[] = [];
  for (let index = 0; index < incoming.length; index++) { const value: unknown = incoming[index]; values.push(value); }
  return { count: incoming.length, values };
}

interface ArgResult { raw: ArgSnapshot; parameters: ArgValue[]; }
type ArgReader = (first: ArgValue, second: ArgValue, third?: ArgValue) => ArgResult;
function declared(first: ArgValue, second: ArgValue): ArgResult { arguments[0] = 13; arguments[1] = 29; return { raw: takeIncoming(arguments), parameters: [first, second] }; }
const expression = function (first: ArgValue, second: ArgValue): ArgResult { arguments[0] = 13; arguments[1] = 29; return { raw: takeIncoming(arguments), parameters: [first, second] }; };
class ArgHolder { reader: ArgReader; constructor(reader: ArgReader) { this.reader = reader; } }
function invoke(holder: ArgHolder, input: [ArgValue, ArgValue, ArgValue]): ArgResult { return holder.reader(...input); }
const holders: ArgHolder[] = [new ArgHolder(declared), new ArgHolder(expression)];
const identity = { mark: 23 }; const inputs: [ArgValue, ArgValue, ArgValue][] = [[-0, NaN, identity], [undefined, null, "tail"], [identity, "", 17]];
for (const holder of holders) for (const input of inputs) {
  const original = input.slice(), actual = invoke(holder, input);
  assert.sameValue(actual.raw.count, 3); assert.compareArray(actual.raw.values, [13, 29, input[2]]);
  assert.compareArray(actual.parameters, [input[0], input[1]]); assert.compareArray(input, original);
}
