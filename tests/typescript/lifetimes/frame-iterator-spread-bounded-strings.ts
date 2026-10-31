/*---
description: Spread retains each bounded string returned by an iterator allocation site.
features: [ts-lifetime-frame, ts-route-iterator, ts-functions, ts-iteration, ts-class, ts-strings, ts-spread, ts-arrays, ts-symbols]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: iterator results enter a spread; node keeps distinct letters after the producer is exhausted.
class Letters implements Iterable<string>, Iterator<string, undefined> {
  index: number; stop: number;
  constructor(start: number) { this.index = start; this.stop = start + 4; }
  [Symbol.iterator](): Iterator<string, undefined> { return this; }
  next(): IteratorResult<string, undefined> {
    if (this.index === this.stop) return { done: true, value: undefined };
    const text = String.fromCharCode(65 + this.index % 26);
    this.index++;
    return { done: false, value: text };
  }
}
for (let n = 0; n < 240; n++) {
  const kept = [...new Letters(n)];
  for (let j = 1; j <= 12; j++) {
    const busy = [...new Letters(n + j)];
    assert.sameValue(busy.join("").length, 4);
  }
  assert.sameValue(kept.length, 4);
  for (let j = 0; j < 4; j++) {
    assert.sameValue(kept[j], "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt((n + j) % 26));
    assert.sameValue(kept[j].length, 1);
  }
}
