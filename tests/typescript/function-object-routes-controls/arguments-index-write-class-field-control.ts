/*---
description: Explicit incoming-list control for a function stored in a declared class field keeps formal parameters unchanged when incoming slots are written.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-class, ts-class-fields, ts-tuples, ts-optional-parameters]
---*/
// A class field carries explicit incoming lists; their private copies can change without changing the local formals.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: ArgValue[]): ArgSnapshot {
  const values: unknown[] = []; let count = 0;
  for (const value of incoming) { values.push(value); count++; }
  return { count, values };
}

interface ArgResult { raw: ArgSnapshot; parameters: ArgValue[]; }
type ArgReader = (input: [ArgValue, ArgValue, ArgValue]) => ArgResult;
function declared(input: [ArgValue, ArgValue, ArgValue]): ArgResult { const incoming = input.slice(), first = incoming[0], second = incoming[1]; incoming[0] = 13; incoming[1] = 29; return { raw: takeIncoming(incoming), parameters: [first, second] }; }
const expression = function (input: [ArgValue, ArgValue, ArgValue]): ArgResult { const incoming = input.slice(), first = incoming[0], second = incoming[1]; incoming[0] = 13; incoming[1] = 29; return { raw: takeIncoming(incoming), parameters: [first, second] }; };
class ArgHolder { reader: ArgReader; constructor(reader: ArgReader) { this.reader = reader; } }
function invoke(holder: ArgHolder, input: [ArgValue, ArgValue, ArgValue]): ArgResult { return holder.reader(input); }
const holders: ArgHolder[] = [new ArgHolder(declared), new ArgHolder(expression)];
const identity = { mark: 23 }; const inputs: [ArgValue, ArgValue, ArgValue][] = [[-0, NaN, identity], [undefined, null, "tail"], [identity, "", 17]];
for (const holder of holders) for (const input of inputs) {
  const original = input.slice(), actual = invoke(holder, input);
  assert.sameValue(actual.raw.count, 3); assert.compareArray(actual.raw.values, [13, 29, input[2]]);
  assert.compareArray(actual.parameters, [input[0], input[1]]); assert.compareArray(input, original);
}
