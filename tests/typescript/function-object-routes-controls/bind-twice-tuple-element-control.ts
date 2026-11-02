/*---
description: Explicit function-record control for Binding a tuple-selected function twice keeps the first receiver, appends both prefixes and prefixes its name twice.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-tuples, ts-this-parameter, ts-this, ts-interfaces]
---*/
// A tuple element crosses two bind operations; the first receiver wins over both later receivers, with exact bound names and lengths.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
interface Callback { body: (self: Receiver, items: Value[]) => Seen; label: string; arity: number; }
function collect(self: Receiver, items: Value[]): Seen { return { self, items }; }
const owner = { method(self: Receiver, items: Value[]): Seen { return { self, items }; } };
const targets: [Callback, Callback] = [{ body: collect, label: "collect", arity: 3 }, { body: owner.method, label: "method", arity: 3 }];
function observe(fn: Callback, firstSelf: Receiver, secondSelf: Receiver, thirdSelf: Receiver, items: [Value, Value, Value]): { result: Seen; labels: string[]; arities: number[] } {
  const first = { body: (tail: Value[]) => fn.body(firstSelf, [items[0]].concat(tail)), label: "bound " + fn.label, arity: Math.max(fn.arity - 1, 0) };
  const second = { body: (tail: Value[]) => first.body([items[1]].concat(tail)), label: "bound " + first.label, arity: Math.max(first.arity - 1, 0) };
  return { result: second.body([items[2]]), labels: [first.label, second.label], arities: [first.arity, second.arity] };
}
const identity = { token: "last" }, inputs: [Value, Value, Value][] = [[-0, NaN, undefined], [null, "", identity], [1, 2, 3]];
for (const index of [0, 1]) for (const items of inputs) {
  const first: Receiver = { tag: "first" }, second: Receiver = { tag: "second" }, third: Receiver = { tag: "third" }, observed = observe(targets[index], first, second, third, items);
  const label = index === 0 ? "collect" : "method";
  assert.compareArray(observed.labels, ["bound " + label, "bound bound " + label]); assert.compareArray(observed.arities, [2, 1]);
  assert.sameValue(observed.result.self, first); assert.compareArray(observed.result.items, items);
  assert.compareArray([first.tag, second.tag, third.tag], ["first", "second", "third"]);
}
