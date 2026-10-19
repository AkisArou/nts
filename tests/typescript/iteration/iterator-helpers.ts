/*---
description: Iterator helpers map, filter and take over a generator lazily and collect with toArray.
features: [ts-iteration, ts-generators]
---*/
let pulled = 0;
function* naturals(): Generator<number> {
  for (let n = 1; ; n++) {
    pulled++;
    yield n;
  }
}
const evens = naturals()
  .filter((n) => n % 2 === 0)
  .map((n) => n * 10)
  .take(3)
  .toArray();
assert.compareArray(evens, [20, 40, 60]);
assert.sameValue(pulled, 6);
