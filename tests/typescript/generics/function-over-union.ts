/*---
description: A generic function instantiated at a union stores and returns its values unchanged.
features: [ts-generics, ts-unions]
---*/
function repeat<T>(value: T, times: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < times; i++) out.push(value);
  return out;
}
function last<T>(items: T[]): T {
  return items[items.length - 1];
}
const first: number | string = 7;
const second: number | string = "seven";
const items = repeat<number | string>(first, 2);
items.push(second);
assert.sameValue(items.length, 3);
assert.sameValue(items[0], first);
assert.sameValue(last(items), second);
const head = items[0];
const tail = last(items);
assert.sameValue(typeof head === "number" ? head + 1 : head.length, 8);
assert.sameValue(typeof tail === "number" ? tail + 1 : tail.length, 5);
