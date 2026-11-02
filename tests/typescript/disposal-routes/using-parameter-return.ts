/*---
description: A resource array parameter is cleaned up before returning to its caller
features: [ts-disposal-route-using-declarations, ts-using, ts-symbols, ts-arrays, ts-functions, ts-unions]
---*/
// A readonly array parameter carries leases across return; node cleans up before the caller resumes.
type Slot = Disposable | null | undefined;
const samples: (string | null | undefined)[][] = [[], ["one"], ["a", null, "c"], ["a", "b", "c"], [null, undefined, "last"]];
function resource(id: string | null | undefined, log: string[]): Slot {
  if (id === null || id === undefined) return id;
  return { [Symbol.dispose]() { log.push("close:" + id); } };
}
function take(items: readonly Slot[], log: string[], result: { token: number }): { token: number } {
  using first = items[0];
  using second = items[1];
  using third = items[2];
  log.push("return");
  return result;
}
for (const sample of samples) {
  const log: string[] = ["caller:before"];
  const items: Slot[] = sample.map(id => resource(id, log));
  const result = { token: sample.length };
  assert.sameValue(take(items, log, result), result);
  log.push("caller:after");
  const expected = ["caller:before", "return"];
  for (let index = sample.length - 1; index >= 0; index--) if (sample[index] !== null && sample[index] !== undefined) expected.push("close:" + sample[index]);
  expected.push("caller:after");
  assert.compareArray(log, expected);
}
