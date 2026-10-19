/*---
description: A generator typed Generator<Yield, Return, Next> receives values through next and ends with its return value.
features: [ts-iteration, ts-generators]
---*/
function* accumulator(): Generator<number, string, number> {
  let total = 0;
  while (total < 10) {
    const added: number = yield total;
    total += added;
  }
  return `total ${total}`;
}
const gen = accumulator();
assert.sameValue(gen.next(0).value, 0);
assert.sameValue(gen.next(4).value, 4);
assert.sameValue(gen.next(5).value, 9);
const end = gen.next(3);
assert.sameValue(end.done, true);
assert.sameValue(end.value, "total 12");
assert.sameValue(gen.next(1).done, true);
