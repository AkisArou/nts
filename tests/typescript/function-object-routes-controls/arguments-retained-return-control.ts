/*---
description: Explicit incoming-list control for returned typed activation records keep distinct arguments objects independent of later parameter and slot writes.
features: [ts-function-object-route-arguments, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-closures, ts-optional-parameters]
---*/
// Typed activation records retain private incoming copies and independent local bindings for each explicit call.
type ArgValue = number | string | null | undefined | { mark: number };
interface ArgSnapshot { count: number; values: unknown[]; }

function takeIncoming(incoming: ArgValue[]): ArgSnapshot {
  const values: unknown[] = []; let count = 0;
  for (const value of incoming) { values.push(value); count++; }
  return { count, values };
}

interface ArgActivation { incoming: ArgValue[]; read: () => ArgValue; write: (value: ArgValue) => void; }
type ArgReader = (values: ArgValue[]) => ArgActivation;
function declared(input: ArgValue[]): ArgActivation { let first = input[0]; return { incoming: input.slice(), read: () => first, write: value => { first = value; } }; }
const expression = function (input: ArgValue[]): ArgActivation { let first = input[0]; return { incoming: input.slice(), read: () => first, write: value => { first = value; } }; };
function invoke(reader: ArgReader, input: ArgValue[]): ArgActivation { return reader(input); }
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
