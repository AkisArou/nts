/*---
description: `using` accepts null and undefined, which are skipped at disposal.
features: [ts-using, ts-null-undefined]
---*/
const log: string[] = [];
function maybe(open: boolean): Disposable | null {
  return open ? { [Symbol.dispose]: () => log.push("disposed") } : null;
}
{
  using none = maybe(false);
  using absent = undefined;
  using some = maybe(true);
  log.push("body");
}
assert.compareArray(log, ["body", "disposed"]);
