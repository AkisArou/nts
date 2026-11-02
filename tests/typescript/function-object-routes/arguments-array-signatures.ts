/*---
description: A declared array of zero, one and several-parameter functions preserves the complete incoming argument list.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-optional-parameters, ts-class, ts-static]
---*/
// Functions in a declared array receive zero through five values; node retains the raw count, order and identities.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: IArguments): ArgSnapshot {
  const values: unknown[] = [];
  for (let index = 0; index < incoming.length; index++) { const value: unknown = incoming[index]; values.push(value); }
  return { count: incoming.length, values };
}

type ArgReader = (...values: ArgValue[]) => ArgSnapshot;
function noParameters(): ArgSnapshot { return takeIncoming(arguments); }
const oneParameter = function (first?: ArgValue): ArgSnapshot { return takeIncoming(arguments); };
const several = { read(first?: ArgValue, second?: ArgValue, third?: ArgValue): ArgSnapshot { return takeIncoming(arguments); } };
class ArgStatic { static read(first?: ArgValue, second?: ArgValue): ArgSnapshot { return takeIncoming(arguments); } }
const readers: ArgReader[] = [noParameters, oneParameter, several.read, ArgStatic.read];
function invoke(reader: ArgReader, input: ArgValue[]): ArgSnapshot { return reader(...input); }

const identity = { mark: 23 };
const rows: { input: ArgValue[]; count: number }[] = [
  { input: [], count: 0 }, { input: [undefined], count: 1 }, { input: [null], count: 1 },
  { input: [-0, NaN, undefined, identity, "tail"], count: 5 }, { input: [identity, "", 17], count: 3 }
];
for (const reader of readers) for (const row of rows) {
  const actual = invoke(reader, row.input);
  assert.sameValue(actual.count, row.count); assert.compareArray(actual.values, row.input);
  assert.sameValue(actual.values === row.input, false);
}
