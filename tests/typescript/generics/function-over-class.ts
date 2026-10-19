/*---
description: A generic function instantiated at a class stores and returns its values unchanged.
features: [ts-generics, ts-class]
---*/
class Coin {
  constructor(public cents: number) {}
}
function repeat<T>(value: T, times: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < times; i++) out.push(value);
  return out;
}
function last<T>(items: T[]): T {
  return items[items.length - 1];
}
const first: Coin = new Coin(5);
const second: Coin = new Coin(25);
const items = repeat<Coin>(first, 2);
items.push(second);
assert.sameValue(items.length, 3);
assert.sameValue(items[0], first);
assert.sameValue(last(items), second);
const head = items[0];
const tail = last(items);
assert.sameValue(head.cents, 5);
assert.sameValue(tail.cents, 25);
