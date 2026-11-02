/*---
description: Explicit incoming-list control for functions returned by a generic identity retain raw omitted and undefined arguments beside their initialized defaults.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-generics, ts-default-parameters, ts-tuples]
---*/
// A generic return carries explicit initializers; raw lists stay separate from initialized local values.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: ArgValue[]): ArgSnapshot {
  const values: unknown[] = []; let count = 0;
  for (const value of incoming) { values.push(value); count++; }
  return { count, values };
}

interface ArgResult { raw: ArgSnapshot; parameters: ArgValue[]; firstRaw: unknown; secondRaw: unknown; }
type ArgReader = (incoming: [ArgValue?, ArgValue?]) => ArgResult;
function retain<T>(value: T): T { return value; }
function declared(incoming: [ArgValue?, ArgValue?]): ArgResult { const first = incoming[0] === undefined ? 91 : incoming[0], second = incoming[1] === undefined ? 73 : incoming[1]; return { raw: takeIncoming(incoming), parameters: [first, second], firstRaw: incoming[0], secondRaw: incoming[1] }; }
const expression = function (incoming: [ArgValue?, ArgValue?]): ArgResult { const first = incoming[0] === undefined ? 91 : incoming[0], second = incoming[1] === undefined ? 73 : incoming[1]; return { raw: takeIncoming(incoming), parameters: [first, second], firstRaw: incoming[0], secondRaw: incoming[1] }; };
const readers: ArgReader[] = [retain(declared), retain(expression)];
function invoke(reader: ArgReader, input: [ArgValue?, ArgValue?]): ArgResult { return reader(input); }
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
