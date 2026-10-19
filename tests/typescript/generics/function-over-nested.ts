/*---
description: A generic function instantiated at a nested generic stores and returns its values unchanged.
features: [ts-generics, ts-class]
---*/
class Box<T> {
  constructor(public value: T) {}
}
function repeat<T>(value: T, times: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < times; i++) out.push(value);
  return out;
}
function last<T>(items: T[]): T {
  return items[items.length - 1];
}
const first: Box<Box<number>> = new Box(new Box(4));
const second: Box<Box<number>> = new Box(new Box(9));
const items = repeat<Box<Box<number>>>(first, 2);
items.push(second);
assert.sameValue(items.length, 3);
assert.sameValue(items[0], first);
assert.sameValue(last(items), second);
const head = items[0];
const tail = last(items);
assert.sameValue(head.value.value, 4);
assert.sameValue(tail.value.value, 9);
