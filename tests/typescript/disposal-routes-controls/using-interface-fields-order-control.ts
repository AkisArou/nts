/*---
description: Nullable interface fields dispose in reverse order at block exit - explicit cleanup control
features: [ts-disposal-route-using-declarations, ts-using, ts-symbols, ts-interfaces, ts-arrays, ts-unions]
---*/
// Optional Disposable fields hold nullable leases; node closes them last-first after the body.
interface Holder { first?: Disposable | null; second?: Disposable | null; third?: Disposable | null; }
type Slot = Disposable | null | undefined;
const samples: (string | null | undefined)[][] = [[], ["one"], ["a", null, "c"], ["a", "b", "c"], [null, undefined, "last"]];
function resource(id: string | null | undefined, log: string[]): Slot {
  if (id === null || id === undefined) return id;
  return { [Symbol.dispose]() { log.push("close:" + id); } };
}
for (const sample of samples) {
  const log: string[] = ["before"];
  const holder: Holder = { first: resource(sample[0], log), second: resource(sample[1], log), third: resource(sample[2], log) };
  {
    const first = holder.first, second = holder.second, third = holder.third;
    try { log.push("body:last"); }
    finally {
      if (third !== null && third !== undefined) third[Symbol.dispose]();
      if (second !== null && second !== undefined) second[Symbol.dispose]();
      if (first !== null && first !== undefined) first[Symbol.dispose]();
    }
  }
  log.push("after");
  const expected = ["before", "body:last"];
  for (let index = sample.length - 1; index >= 0; index--) if (sample[index] !== null && sample[index] !== undefined) expected.push("close:" + sample[index]);
  expected.push("after");
  assert.compareArray(log, expected);
}
