/*---
description: "Control: Empty reductions and frozen alias writes retain TypeError classification beside RangeError through a generic helper."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-generics, ts-generic-constraints, ts-function-types, ts-arrow-functions, ts-closures, ts-optional-parameters, ts-numbers, ts-interfaces, ts-objects]
flags: [module]
---*/
// A generic expectThrow helper carries two explicit error type arguments and typed operation callbacks; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-reduction-frozen-generic-expect-throw:ok.
function refuseReduce(values: readonly number[], reducer: (left: number, right: number) => number): never { throw new TypeError(); }
function refuseWrite(target: ThrowCell, next: number): never { throw new TypeError(); }
function refuseArray(count: number): never { throw new RangeError(); }
const log: string[] = [];
function expectThrow<E extends Error>(expected: new (message?: string) => E, operation: () => unknown): void {
  let caught: unknown; let threw: boolean = false;
  try { operation(); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof expected, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof expected) log.push(caught.name);
}
interface ThrowCell { value: number; }
const inputs: number[][] = [[], []];
const add = (left: number, right: number): number => left + right;
for (let index = 0; index < inputs.length; index++) {
  const values: number[] = inputs[index]; expectThrow<TypeError>(TypeError, () => { log.push("reduce:" + index); return refuseReduce(values, add); });
}
const targets: ThrowCell[] = [{ value: 4 }, { value: -2 }];
for (const target of targets) {
  const alias: ThrowCell = target, next: number = target.value + 10; Object.freeze(target);
  expectThrow<TypeError>(TypeError, () => { log.push("freeze:" + alias.value + ":" + next); refuseWrite(alias, next); });
}
for (const count of [-1, -2]) expectThrow<RangeError>(RangeError, () => { log.push("array:" + count); return refuseArray(count); });
assert.compareArray(targets.map((target) => target.value), [4, -2]);
assert.compareArray(log, ["reduce:0", "TypeError", "reduce:1", "TypeError", "freeze:4:14", "TypeError", "freeze:-2:8", "TypeError", "array:-1", "RangeError", "array:-2", "RangeError"]);
console.log("builtin-throws-reduction-frozen-generic-expect-throw:ok");
