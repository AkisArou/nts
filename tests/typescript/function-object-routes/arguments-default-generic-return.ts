/*---
description: Functions returned by a generic identity retain raw omitted and undefined arguments beside their initialized defaults.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-generics, ts-default-parameters, ts-tuples]
---*/
// A generic return carries defaulted functions; node counts only supplied values and preserves raw undefined and null.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: IArguments): ArgSnapshot {
  const values: unknown[] = [];
  for (let index = 0; index < incoming.length; index++) { const value: unknown = incoming[index]; values.push(value); }
  return { count: incoming.length, values };
}

interface ArgResult { raw: ArgSnapshot; parameters: ArgValue[]; firstRaw: unknown; secondRaw: unknown; }
type ArgReader = (first?: ArgValue, second?: ArgValue) => ArgResult;
function retain<T>(value: T): T { return value; }
function declared(first: ArgValue = 91, second: ArgValue = 73): ArgResult { return { raw: takeIncoming(arguments), parameters: [first, second], firstRaw: arguments[0], secondRaw: arguments[1] }; }
const expression = function (first: ArgValue = 91, second: ArgValue = 73): ArgResult { return { raw: takeIncoming(arguments), parameters: [first, second], firstRaw: arguments[0], secondRaw: arguments[1] }; };
const readers: ArgReader[] = [retain(declared), retain(expression)];
function invoke(reader: ArgReader, input: [ArgValue?, ArgValue?]): ArgResult { return reader(...input); }
const rows: { input: [ArgValue?, ArgValue?]; count: number; parameters: ArgValue[] }[] = [
  { input: [], count: 0, parameters: [91, 73] }, { input: [undefined], count: 1, parameters: [91, 73] },
  { input: [null], count: 1, parameters: [null, 73] }, { input: [undefined, null], count: 2, parameters: [91, null] },
  { input: [-0, NaN], count: 2, parameters: [-0, NaN] }
];
for (const reader of readers) for (const row of rows) {
  const actual = invoke(reader, row.input);
  assert.sameValue(actual.raw.count, row.count); assert.compareArray(actual.raw.values, row.input);
  assert.compareArray(actual.parameters, row.parameters);
  assert.sameValue(actual.firstRaw, row.input[0]); assert.sameValue(actual.secondRaw, row.input[1]);
}
