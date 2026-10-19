/*---
description: A generic function instantiated at number stores and returns its values unchanged.
features: [ts-generics]
---*/
function repeat<T>(value: T, times: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < times; i++) out.push(value);
  return out;
}
function last<T>(items: T[]): T {
  return items[items.length - 1];
}
const first: number = 2;
const second: number = 5;
const items = repeat<number>(first, 2);
items.push(second);
assert.sameValue(items.length, 3);
assert.sameValue(items[0], first);
assert.sameValue(last(items), second);
const head = items[0];
const tail = last(items);
assert.sameValue(head * 10, 20);
assert.sameValue(tail * 10, 50);
