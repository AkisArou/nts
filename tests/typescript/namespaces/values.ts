/*---
description: A namespace holds the values it exports, and its functions see them.
features: [ts-namespace]
---*/
namespace Counter {
  export const start = 1;
  export function next(): number {
    return start + 1;
  }
}
assert.sameValue(Counter.start, 1);
assert.sameValue(Counter.next(), 2);
