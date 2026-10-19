/*---
description: A `using` of a value with no dispose method throws TypeError at the declaration.
features: [ts-using, ts-any, ts-errors]
---*/
const notDisposable: any = { close: () => 0 };
const log: string[] = [];
assert.throws(TypeError, () => {
  using resource = notDisposable;
  log.push("unreached");
});
assert.sameValue(log.length, 0);
