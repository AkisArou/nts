/*---
description: "Control: Adding optional fields through mutable aliases of sealed objects throws TypeError through readonly operations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures, ts-interfaces, ts-objects, ts-numbers, ts-optional-properties]
flags: [module]
---*/
// A readonly callback array captures optional-field aliases of separately sealed objects; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-sealed-add-readonly-operations:ok.
function refuseAdd(target: ThrowCell, next: number): never { throw new TypeError(); }
const log: string[] = [];
interface ThrowCell { value: number; extra?: number; }
const targets: ThrowCell[] = [{ value: 1 }, { value: 0 }, { value: -3 }];
const operations: readonly (() => unknown)[] = targets.map((target, index) => {
  const alias: ThrowCell = target, next: number = index + 21; Object.seal(target);
  return () => { log.push(alias.value + ":" + next); refuseAdd(alias, next); };
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
for (const target of targets) { assert.sameValue(Object.hasOwn(target, "extra"), false); assert.compareArray(Object.keys(target), ["value"]); }
assert.compareArray(log, ["1:21", "TypeError", "0:22", "TypeError", "-3:23", "TypeError"]);
console.log("builtin-throws-sealed-add-readonly-operations:ok");
