/*---
description: A generic function instantiated at a function type stores and returns its values unchanged.
features: [ts-generics, ts-function-types]
---*/
function repeat<T>(value: T, times: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < times; i++) out.push(value);
  return out;
}
function last<T>(items: T[]): T {
  return items[items.length - 1];
}
const first: (n: number) => number = (n: number) => n + 1;
const second: (n: number) => number = (n: number) => n * 3;
const items = repeat<(n: number) => number>(first, 2);
items.push(second);
assert.sameValue(items.length, 3);
assert.sameValue(items[0], first);
assert.sameValue(last(items), second);
const head = items[0];
const tail = last(items);
assert.sameValue(head(4), 5);
assert.sameValue(tail(4), 12);
