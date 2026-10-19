/*---
description: A class with a Symbol.iterator generator method is iterable by for-of and spread.
features: [ts-iteration, ts-class, ts-symbols, ts-generators]
---*/
class Span implements Iterable<number> {
  constructor(private start: number, private end: number) {}
  *[Symbol.iterator](): Iterator<number> {
    for (let n = this.start; n < this.end; n++) yield n;
  }
}
const seen: number[] = [];
for (const n of new Span(1, 4)) seen.push(n);
assert.compareArray(seen, [1, 2, 3]);
assert.compareArray([...new Span(5, 7)], [5, 6]);
assert.sameValue(Math.max(...new Span(0, 10)), 9);
