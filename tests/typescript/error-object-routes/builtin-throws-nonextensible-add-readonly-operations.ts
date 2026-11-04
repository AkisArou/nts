/*---
description: "Adding named fields through index-signature aliases of nonextensible objects throws TypeError through readonly operations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures, ts-interfaces, ts-objects, ts-numbers, ts-index-signatures]
flags: [module]
---*/
// A readonly callback array captures index-signature aliases and distinct field names. Each caught value has the specified standard class and Error brand; node prints builtin-throws-nonextensible-add-readonly-operations:ok.
const log: string[] = [];
interface ThrowTable { [key: string]: number; }
const targets: ThrowTable[] = [{ value: 1 }, { value: 0 }, { value: -3 }];
const names: readonly string[] = ["left", "middle", "right"];
const operations: readonly (() => unknown)[] = targets.map((target, index) => {
  const alias: ThrowTable = target, key: string = names[index], next: number = index + 31; Object.preventExtensions(target);
  return () => { log.push(alias.value + ":" + key + ":" + next); alias[key] = next; };
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
for (const target of targets) assert.compareArray(Object.keys(target), ["value"]);
assert.compareArray(log, ["1:left:31", "TypeError", "0:middle:32", "TypeError", "-3:right:33", "TypeError"]);
console.log("builtin-throws-nonextensible-add-readonly-operations:ok");
