/*---
description: Returned typed activation records keep distinct arguments objects independent of later parameter and slot writes.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-closures, ts-optional-parameters]
---*/
// A typed function return retains each activation; node keeps raw slots, formal bindings and separate calls independent.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: IArguments): ArgSnapshot {
  const values: unknown[] = [];
  for (let index = 0; index < incoming.length; index++) { const value: unknown = incoming[index]; values.push(value); }
  return { count: incoming.length, values };
}

interface ArgActivation { incoming: IArguments; read: () => ArgValue; write: (value: ArgValue) => void; }
type ArgReader = (...values: ArgValue[]) => ArgActivation;
function declared(first?: ArgValue): ArgActivation { return { incoming: arguments, read: () => first, write: value => { first = value; } }; }
const expression = function (first?: ArgValue, second?: ArgValue): ArgActivation { return { incoming: arguments, read: () => first, write: value => { first = value; } }; };
function invoke(reader: ArgReader, input: ArgValue[]): ArgActivation { return reader(...input); }
function observe(value: ArgActivation): ArgSnapshot { return takeIncoming(value.incoming); }
const readers: ArgReader[] = [declared, expression];
const identity = { mark: 23 }; const rows: { input: ArgValue[]; count: number }[] = [{ input: [undefined], count: 1 }, { input: [-0, NaN, identity], count: 3 }, { input: [identity, null, "tail"], count: 3 }];
for (const reader of readers) for (const row of rows) {
  const first = invoke(reader, row.input), second = invoke(reader, row.input), original = row.input.slice();
  assert.sameValue(first.incoming === second.incoming, false); first.write(61);
  assert.sameValue(first.read(), 61); assert.sameValue(second.read(), row.input[0]);
  assert.sameValue(observe(first).count, row.count); assert.compareArray(observe(first).values, row.input);
  first.incoming[0] = 83; const changed = row.input.slice(); changed[0] = 83;
  assert.sameValue(first.read(), 61); assert.compareArray(observe(first).values, changed);
  assert.sameValue(observe(second).count, row.count); assert.compareArray(observe(second).values, row.input);
  assert.sameValue(second.read(), row.input[0]); assert.compareArray(row.input, original);
}
