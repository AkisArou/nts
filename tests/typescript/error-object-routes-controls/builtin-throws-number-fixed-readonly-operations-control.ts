/*---
description: "Control: Out of range toFixed precision throws RangeError through readonly operations even for a large formatted value."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures, ts-numbers, ts-tuples]
flags: [module]
---*/
// A readonly array of declared operation callbacks captures each typed input; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-number-fixed-readonly-operations:ok.
function refuseFixed(value: number, digits: number): never { throw new RangeError(); }
const log: string[] = [];
const inputs: readonly [number, number][] = [[1, 101], [-0, 102], [1e21, 1000]];
const operations: readonly (() => unknown)[] = inputs.map((input) => (): unknown => { log.push(input.join(":")); return refuseFixed(input[0], input[1]); });
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index](); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof RangeError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["1:101", "RangeError", "0:102", "RangeError", "1e+21:1000", "RangeError"]);
console.log("builtin-throws-number-fixed-readonly-operations:ok");
