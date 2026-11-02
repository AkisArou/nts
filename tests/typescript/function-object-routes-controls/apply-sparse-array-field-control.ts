/*---
description: Explicit function-record control for Apply reads every position of sparse argument arrays carried beside a typed callback field.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-this-parameter, ts-this, ts-rest-parameters, ts-objects, ts-unions]
---*/
// A holder field supplies a rest callback and sparse inputs; apply turns holes into undefined arguments while keeping the source holes.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
type Callback = (self: Receiver, items: Value[]) => Seen;
interface Holder { fn: Callback; input: Value[]; }
function collect(self: Receiver, items: Value[]): Seen { return { self, items }; }
const owner = { method(self: Receiver, items: Value[]): Seen { return { self, items }; } };
function invoke(holder: Holder, receiver: Receiver): Seen { const items: Value[] = []; for (const value of holder.input) items.push(value); return holder.fn(receiver, items); }
const choices: Callback[] = [collect, owner.method];
const identity = { token: "sparse" }, rows: { input: Value[]; expected: Value[]; keys: string[] }[] = [
  { input: [], expected: [], keys: [] }, { input: [,], expected: [undefined], keys: [] },
  { input: [undefined], expected: [undefined], keys: ["0"] },
  { input: [, -0, , NaN, identity, ,], expected: [undefined, -0, undefined, NaN, identity, undefined], keys: ["1", "3", "4"] }
];
for (const fn of choices) for (const row of rows) {
  const receiver: Receiver = { tag: "sparse" }, holder: Holder = { fn, input: row.input }, result = invoke(holder, receiver);
  assert.sameValue(result.self, receiver); assert.compareArray(result.items, row.expected);
  assert.compareArray(Object.keys(holder.input), row.keys); assert.compareArray(holder.input, row.expected);
  assert.compareArray(Object.keys(result.items), row.expected.map((value, index) => String(index)));
  assert.sameValue(result.items === holder.input, false);
}
