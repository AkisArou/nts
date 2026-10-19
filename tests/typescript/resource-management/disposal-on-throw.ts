/*---
description: A resource is disposed when its block exits by an exception, and the exception still propagates.
features: [ts-using, ts-errors]
---*/
const log: string[] = [];
function risky(): void {
  using lock = { [Symbol.dispose]: () => log.push("released") };
  log.push("locked");
  throw new RangeError("failed");
}
assert.throws(RangeError, risky);
assert.compareArray(log, ["locked", "released"]);
