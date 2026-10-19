/*---
description: Array destructuring reads only as many values from an iterator as it needs.
features: [ts-iteration, ts-generators, ts-destructuring]
---*/
let produced = 0;
function* produce(): Generator<number> {
  while (true) {
    produced++;
    yield produced * 10;
  }
}
const [first, second] = produce();
assert.sameValue(first, 10);
assert.sameValue(second, 20);
assert.sameValue(produced, 2);
const [head, ...rest] = new Set([1, 2, 3]);
assert.sameValue(head, 1);
assert.compareArray(rest, [2, 3]);
