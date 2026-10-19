/*---
description: A namespace exports a generator function like any function.
features: [ts-namespace, ts-generators]
---*/
namespace Sequence {
  export function* upTo(limit: number): Generator<number> {
    for (let i = 1; i <= limit; i++) yield i;
  }
}
const seen: number[] = [...Sequence.upTo(3)];
assert.compareArray(seen, [1, 2, 3]);
