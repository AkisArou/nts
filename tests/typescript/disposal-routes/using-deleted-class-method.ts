/*---
description: A deleted class disposer is rejected through an array of its declared type
features: [ts-disposal-route-using-declarations, ts-using, ts-symbols, ts-class, ts-class-fields, ts-arrays, ts-errors]
---*/
// A typed class array loses one own disposer at runtime; node throws at acquisition and closes only prior leases.
class Lease implements Disposable {
  readonly id: number; readonly log: string[];
  constructor(id: number, log: string[]) { this.id = id; this.log = log; }
  [Symbol.dispose]: () => void = (): void => { this.log.push("close:" + this.id); };
}
for (const count of [0, 1, 3]) for (const removed of [-1, 0, 1, 2]) {
  if (removed >= count) continue;
  const log: string[] = ["before"];
  const items: Lease[] = [];
  for (let index = 0; index < count; index++) items.push(new Lease(index, log));
  if (removed >= 0) {
    assert.sameValue(Reflect.deleteProperty(items[removed], Symbol.dispose), true);
    assert.sameValue(Symbol.dispose in items[removed], false);
  }
  const run = (): void => {
    using first = items[0];
    using second = items[1];
    using third = items[2];
    log.push("body:last");
  };
  if (removed < 0) run(); else assert.throws(TypeError, run);
  log.push("after");
  const expected = ["before"];
  if (removed < 0) expected.push("body:last");
  for (let index = (removed < 0 ? count : removed) - 1; index >= 0; index--) expected.push("close:" + index);
  expected.push("after");
  assert.compareArray(log, expected);
}
