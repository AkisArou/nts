/*---
description: Explicit incoming-list control for a declared array of zero, one and several-parameter functions preserves the complete incoming argument list.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-optional-parameters, ts-class, ts-static]
---*/
// Explicit incoming arrays cross the same function-array route; a loop records each count and value.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: ArgValue[]): ArgSnapshot {
  const values: unknown[] = []; let count = 0;
  for (const value of incoming) { values.push(value); count++; }
  return { count, values };
}

type ArgReader = (values: ArgValue[]) => ArgSnapshot;
function noParameters(incoming: ArgValue[]): ArgSnapshot { return takeIncoming(incoming); }
const oneParameter = function (incoming: ArgValue[]): ArgSnapshot { return takeIncoming(incoming); };
const several = { read(incoming: ArgValue[]): ArgSnapshot { return takeIncoming(incoming); } };
class ArgStatic { static read(incoming: ArgValue[]): ArgSnapshot { return takeIncoming(incoming); } }
const readers: ArgReader[] = [noParameters, oneParameter, several.read, ArgStatic.read];
function invoke(reader: ArgReader, input: ArgValue[]): ArgSnapshot { return reader(input); }

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
