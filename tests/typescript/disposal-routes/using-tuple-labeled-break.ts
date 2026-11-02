/*---
description: Tuple resources are disposed when a labeled break exits their block
features: [ts-disposal-route-using-declarations, ts-using, ts-symbols, ts-tuples, ts-arrays, ts-unions]
---*/
// A declared nullable Disposable tuple crosses a labeled break; node disposes before the label resumes.
type Slot = Disposable | null | undefined;
const samples: (string | null | undefined)[][] = [[], ["one"], ["a", null, "c"], ["a", "b", "c"], [null, undefined, "last"]];
function resource(id: string | null | undefined, log: string[]): Slot {
  if (id === null || id === undefined) return id;
  return { [Symbol.dispose]() { log.push("close:" + id); } };
}
for (const sample of samples) {
  const log: string[] = ["before"];
  const items: [Slot, Slot, Slot] = [resource(sample[0], log), resource(sample[1], log), resource(sample[2], log)];
  scope: {
    using first = items[0];
    using second = items[1];
    using third = items[2];
    log.push("break");
    break scope;
  }
  log.push("after");
  const expected = ["before", "break"];
  for (let index = sample.length - 1; index >= 0; index--) if (sample[index] !== null && sample[index] !== undefined) expected.push("close:" + sample[index]);
  expected.push("after");
  assert.compareArray(log, expected);
}
