/*---
description: An infinite generator is consumed lazily by a generic take.
features: [ts-iteration, ts-generators, ts-generics]
---*/
function* naturals(): Generator<number, never> {
  let n = 0;
  while (true) yield n++;
}
function* take<T>(source: Iterable<T>, count: number): Generator<T> {
  if (count <= 0) return;
  for (const item of source) {
    yield item;
    if (--count === 0) return;
  }
}
assert.compareArray([...take(naturals(), 4)], [0, 1, 2, 3]);
const squares = Array.from(take(naturals(), 3), (n) => n * n);
assert.compareArray(squares, [0, 1, 4]);
