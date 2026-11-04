/*---
description: "Control: Zero, negative and oversized toPrecision arguments throw RangeError through readonly operations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures, ts-numbers, ts-tuples]
flags: [module]
---*/
// A readonly array of declared operation callbacks captures each typed input; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-number-precision-readonly-operations:ok.
function refusePrecision(value: number, digits: number): never { throw new RangeError(); }
const log: string[] = [];
const inputs: readonly [number, number][] = [[1, 0], [12.5, -1], [-0, 101]];
const operations: readonly (() => unknown)[] = inputs.map((input) => (): unknown => { log.push(input.join(":")); return refusePrecision(input[0], input[1]); });
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index](); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof RangeError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["1:0", "RangeError", "12.5:-1", "RangeError", "0:101", "RangeError"]);
console.log("builtin-throws-number-precision-readonly-operations:ok");
