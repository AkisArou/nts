/*---
description: A constrained generic resource array unwinds before the catch
features: [ts-disposal-route-using-declarations, ts-using, ts-symbols, ts-generics, ts-arrays, ts-errors, ts-unions]
---*/
// A constrained generic carries nullable resources into a throwing body; node keeps the thrown identity.
type Slot = Disposable | null | undefined;
const samples: (string | null | undefined)[][] = [[], ["one"], ["a", null, "c"], ["a", "b", "c"], [null, undefined, "last"]];
function resource(id: string | null | undefined, log: string[]): Slot {
  if (id === null || id === undefined) return id;
  return { [Symbol.dispose]() { log.push("close:" + id); } };
}
function raise<T extends Disposable>(items: readonly (T | null | undefined)[], log: string[], error: unknown): never {
  using first = items[0];
  using second = items[1];
  using third = items[2];
  log.push("throw");
  throw error;
}
for (const sample of samples) for (const error of [{ token: sample.length }, undefined]) {
  const log: string[] = ["before"];
  const items: Slot[] = sample.map(id => resource(id, log));
  let caught = false;
  try { raise(items, log, error); }
  catch (actual: unknown) { caught = true; assert.sameValue(actual, error); log.push("catch"); }
  log.push("after");
  const expected = ["before", "throw"];
  for (let index = sample.length - 1; index >= 0; index--) if (sample[index] !== null && sample[index] !== undefined) expected.push("close:" + sample[index]);
  expected.push("catch", "after");
  assert.sameValue(caught, true);
  assert.compareArray(log, expected);
}
