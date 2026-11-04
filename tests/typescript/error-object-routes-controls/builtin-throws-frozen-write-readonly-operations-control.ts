/*---
description: "Control: Writes through mutable aliases of frozen objects throw TypeError through readonly operations and leave each value unchanged."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures, ts-interfaces, ts-objects, ts-numbers]
flags: [module]
---*/
// A readonly callback array captures separate mutable interface aliases of frozen objects; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-frozen-write-readonly-operations:ok.
function refuseWrite(target: ThrowCell, next: number): never { throw new TypeError(); }
const log: string[] = [];
interface ThrowCell { value: number; }
const targets: ThrowCell[] = [{ value: 1 }, { value: 0 }, { value: -3 }];
const operations: readonly (() => unknown)[] = targets.map((target, index) => {
  const alias: ThrowCell = target, next: number = index + 11; Object.freeze(target);
  return () => { log.push(alias.value + ":" + next); refuseWrite(alias, next); };
});
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index](); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof TypeError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(targets.map((target) => target.value), [1, 0, -3]);
assert.compareArray(log, ["1:11", "TypeError", "0:12", "TypeError", "-3:13", "TypeError"]);
console.log("builtin-throws-frozen-write-readonly-operations:ok");
