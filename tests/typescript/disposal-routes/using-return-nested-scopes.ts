/*---
description: Typed resource factory returns have nested block lifetimes
features: [ts-disposal-route-using-declarations, ts-using, ts-symbols, ts-functions, ts-arrays, ts-unions]
---*/
// A typed factory return carries nullable leases into nested blocks; node closes inner leases first.
type Slot = Disposable | null | undefined;
const samples: (string | null | undefined)[][] = [[], ["one"], ["a", null, "c"], ["a", "b", "c"], [null, undefined, "last"]];
function resource(id: string | null | undefined, log: string[]): Slot {
  if (id === null || id === undefined) return id;
  return { [Symbol.dispose]() { log.push("close:" + id); } };
}
for (const sample of samples) {
  const log: string[] = ["before"];
  {
    using outer = resource(sample[0], log);
    {
      using inner = resource(sample[1], log);
      using last = resource(sample[2], log);
      log.push("inner:last");
    }
    log.push("outer:last");
  }
  log.push("after");
  const expected = ["before", "inner:last"];
  for (let index = 2; index >= 1; index--) if (sample[index] !== null && sample[index] !== undefined) expected.push("close:" + sample[index]);
  expected.push("outer:last");
  if (sample[0] !== null && sample[0] !== undefined) expected.push("close:" + sample[0]);
  expected.push("after");
  assert.compareArray(log, expected);
}
