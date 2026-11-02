/*---
description: Explicit function-record control for An interface-returned zero-argument callback receives an empty list from apply with its argument array omitted.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-this-parameter, ts-this, ts-rest-parameters, ts-tuples]
---*/
// A factory returns declared callable interfaces; omitted and empty apply lists both reach the exact receiver with no operands.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
interface Callable { (self: Receiver, items: Value[]): Seen; }
function collect(self: Receiver, items: Value[]): Seen { return { self, items }; }
const owner = { method(self: Receiver, items: Value[]): Seen { return { self, items }; } };
function select(index: number): Callable { return index === 0 ? collect : owner.method; }
function observe(fn: Callable, receiver: Receiver): [Seen, Seen] { return [fn(receiver, []), fn(receiver, [])]; }
for (const index of [0, 1]) for (const tag of ["", "first", "second"]) {
  const receiver: Receiver = { tag }, fn: Callable = select(index), results = observe(fn, receiver);
  for (const result of results) { assert.sameValue(result.self, receiver); assert.compareArray(result.items, []); }
  assert.sameValue(results[0].items === results[1].items, false); assert.sameValue(receiver.tag, tag);
}
