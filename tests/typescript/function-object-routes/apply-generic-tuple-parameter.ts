/*---
description: A generic apply helper forwards heterogeneous tuple elements and the exact receiver through a typed function parameter.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-generics, ts-this-parameter, ts-this, ts-tuples, ts-interfaces]
---*/
// Declaration and expression callbacks cross a generic parameter; apply preserves the heterogeneous tuple in order and does not change it.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
function collect<T, U>(this: Receiver, first: T, second: U): { self: Receiver; items: [T, U] } { return { self: this, items: [first, second] }; }
const second = function capture<T, U>(this: Receiver, first: T, second: U): { self: Receiver; items: [T, U] } { return { self: this, items: [first, second] }; };
function invoke<T, U>(fn: (this: Receiver, first: T, second: U) => { self: Receiver; items: [T, U] }, receiver: Receiver, items: [T, U]): { self: Receiver; items: [T, U] } { return fn.apply(receiver, items); }
const choices: ((this: Receiver, first: Value, second: string) => { self: Receiver; items: [Value, string] })[] = [collect, second];
const identity = { token: "tuple" }, inputs: [Value, string][] = [[-0, "zero"], [NaN, "nan"], [undefined, ""], [identity, "object"]];
for (const fn of choices) for (const items of inputs) {
  const receiver: Receiver = { tag: "generic" }, before: [Value, string] = [items[0], items[1]], result = invoke(fn, receiver, items);
  assert.sameValue(result.self, receiver); assert.compareArray(result.items, before);
  assert.compareArray(items, before); assert.sameValue(result.items === items, false);
}
