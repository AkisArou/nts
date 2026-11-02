/*---
description: Explicit incoming-list control for a call-signature parameter keeps strict arguments unchanged when both formal parameters are reassigned.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-tuples]
---*/
// The call signature carries explicit incoming arrays; reassigned local formals never write that array.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: ArgValue[]): ArgSnapshot {
  const values: unknown[] = []; let count = 0;
  for (const value of incoming) { values.push(value); count++; }
  return { count, values };
}

interface ArgResult { raw: ArgSnapshot; parameters: ArgValue[]; }
interface ArgReader { (incoming: [ArgValue, ArgValue]): ArgResult; }
function declared(incoming: [ArgValue, ArgValue]): ArgResult { let first = incoming[0], second = incoming[1]; first = 13; second = 29; return { raw: takeIncoming(incoming), parameters: [first, second] }; }
const expression = function (incoming: [ArgValue, ArgValue]): ArgResult { let first = incoming[0], second = incoming[1]; first = 13; second = 29; return { raw: takeIncoming(incoming), parameters: [first, second] }; };
function invoke(reader: ArgReader, input: [ArgValue, ArgValue]): ArgResult { return reader(input); }
const readers: ArgReader[] = [declared, expression];
const identity = { mark: 23 }; const inputs: [ArgValue, ArgValue][] = [[-0, NaN], [undefined, null], [identity, "tail"]];
for (const reader of readers) for (const input of inputs) {
  const original = input.slice(), actual = invoke(reader, input);
  assert.sameValue(actual.raw.count, 2); assert.compareArray(actual.raw.values, original);
  assert.compareArray(actual.parameters, [13, 29]); assert.compareArray(input, original);
}
