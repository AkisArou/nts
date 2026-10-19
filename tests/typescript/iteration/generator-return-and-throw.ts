/*---
description: A generator's return and throw methods end it early, running its finally block.
features: [ts-iteration, ts-generators, ts-errors]
---*/
const log: string[] = [];
function* guarded(): Generator<number> {
  try {
    yield 1;
    yield 2;
  } finally {
    log.push("cleanup");
  }
}
const first = guarded();
first.next();
assert.sameValue(first.return(99).value, 99);
const second = guarded();
second.next();
assert.throws(TypeError, () => {
  second.throw(new TypeError("stop"));
});
assert.compareArray(log, ["cleanup", "cleanup"]);
