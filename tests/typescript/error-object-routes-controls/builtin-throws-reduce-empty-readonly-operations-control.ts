/*---
description: "Control: Empty number, string and boolean reductions without an initial value throw TypeError through readonly operations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures, ts-numbers]
flags: [module]
---*/
// A readonly array stores reductions over three declared array element types; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-reduce-empty-readonly-operations:ok.
function refuseReduce(values: readonly unknown[], reducer: unknown): never { throw new TypeError(); }
const log: string[] = [];
const numbers: number[] = [], words: string[] = [], flags: boolean[] = [];
const add = (left: number, right: number): number => left + right;
const join = (left: string, right: string): string => left + right;
const both = (left: boolean, right: boolean): boolean => left && right;
const operations: readonly (() => unknown)[] = [
  () => { log.push("number"); return refuseReduce(numbers, add); },
  () => { log.push("string"); return refuseReduce(words, join); },
  () => { log.push("boolean"); return refuseReduce(flags, both); }
];
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index](); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof TypeError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["number", "TypeError", "string", "TypeError", "boolean", "TypeError"]);
console.log("builtin-throws-reduce-empty-readonly-operations:ok");
