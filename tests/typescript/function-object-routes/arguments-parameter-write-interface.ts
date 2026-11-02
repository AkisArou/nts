/*---
description: A call-signature parameter keeps strict arguments unchanged when both formal parameters are reassigned.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-tuples]
---*/
// A call-signature parameter carries functions that reassign their formals; node leaves both incoming slots unchanged.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: IArguments): ArgSnapshot {
  const values: unknown[] = [];
  for (let index = 0; index < incoming.length; index++) { const value: unknown = incoming[index]; values.push(value); }
  return { count: incoming.length, values };
}

interface ArgResult { raw: ArgSnapshot; parameters: ArgValue[]; }
interface ArgReader { (first: ArgValue, second: ArgValue): ArgResult; }
function declared(first: ArgValue, second: ArgValue): ArgResult { first = 13; second = 29; return { raw: takeIncoming(arguments), parameters: [first, second] }; }
const expression = function (first: ArgValue, second: ArgValue): ArgResult { first = 13; second = 29; return { raw: takeIncoming(arguments), parameters: [first, second] }; };
function invoke(reader: ArgReader, input: [ArgValue, ArgValue]): ArgResult { return reader(...input); }
const readers: ArgReader[] = [declared, expression];
const identity = { mark: 23 }; const inputs: [ArgValue, ArgValue][] = [[-0, NaN], [undefined, null], [identity, "tail"]];
for (const reader of readers) for (const input of inputs) {
  const original = input.slice(), actual = invoke(reader, input);
  assert.sameValue(actual.raw.count, 2); assert.compareArray(actual.raw.values, original);
  assert.compareArray(actual.parameters, [13, 29]); assert.compareArray(input, original);
}
