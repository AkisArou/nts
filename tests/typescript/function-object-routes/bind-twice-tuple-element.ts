/*---
description: Binding a tuple-selected function twice keeps the first receiver, appends both prefixes and prefixes its name twice.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-tuples, ts-this-parameter, ts-this, ts-interfaces]
---*/
// A tuple element crosses two bind operations; the first receiver wins over both later receivers, with exact bound names and lengths.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
type Callback = (this: Receiver, a: Value, b: Value, c: Value) => Seen;
function collect(this: Receiver, a: Value, b: Value, c: Value): Seen { return { self: this, items: [a, b, c] }; }
const owner = { method(this: Receiver, a: Value, b: Value, c: Value): Seen { return { self: this, items: [a, b, c] }; } };
const targets: [Callback, Callback] = [collect, owner.method];
function observe(fn: Callback, firstSelf: Receiver, secondSelf: Receiver, thirdSelf: Receiver, items: [Value, Value, Value]): { result: Seen; labels: string[]; arities: number[] } {
  const first = fn.bind(firstSelf, items[0]), second = first.bind(secondSelf, items[1]);
  return { result: second.call(thirdSelf, items[2]), labels: [first.name, second.name], arities: [first.length, second.length] };
}
const identity = { token: "last" }, inputs: [Value, Value, Value][] = [[-0, NaN, undefined], [null, "", identity], [1, 2, 3]];
for (const index of [0, 1]) for (const items of inputs) {
  const first: Receiver = { tag: "first" }, second: Receiver = { tag: "second" }, third: Receiver = { tag: "third" }, observed = observe(targets[index], first, second, third, items);
  const label = index === 0 ? "collect" : "method";
  assert.compareArray(observed.labels, ["bound " + label, "bound bound " + label]); assert.compareArray(observed.arities, [2, 1]);
  assert.sameValue(observed.result.self, first); assert.compareArray(observed.result.items, items);
  assert.compareArray([first.tag, second.tag, third.tag], ["first", "second", "third"]);
}
