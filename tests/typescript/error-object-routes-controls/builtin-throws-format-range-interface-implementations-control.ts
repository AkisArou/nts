/*---
description: "Control: Out of range fixed and significant precision arguments throw RangeError through two operation implementations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-numbers]
flags: [module]
---*/
// An Operation interface dispatches to two concrete class implementations with declared fields; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-format-range-interface-implementations:ok.
function refuseFixed(value: number, digits: number): never { throw new RangeError(); }
function refusePrecision(value: number, digits: number): never { throw new RangeError(); }
const log: string[] = [];
interface ThrowOperation { run(): unknown; }
class FixedFormatter implements ThrowOperation {
  value: number; digits: number; constructor(value: number, digits: number) { this.value = value; this.digits = digits; }
  run(): unknown { log.push("fixed:" + this.value + ":" + this.digits); return refuseFixed(this.value, this.digits); }
}
class PrecisionFormatter implements ThrowOperation {
  value: number; digits: number; constructor(value: number, digits: number) { this.value = value; this.digits = digits; }
  run(): unknown { log.push("precision:" + this.value + ":" + this.digits); return refusePrecision(this.value, this.digits); }
}
const operations: ThrowOperation[] = [new FixedFormatter(1, 101), new PrecisionFormatter(1, 0), new FixedFormatter(-2, -1), new PrecisionFormatter(3, 101)];
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index].run(); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof RangeError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["fixed:1:101", "RangeError", "precision:1:0", "RangeError", "fixed:-2:-1", "RangeError", "precision:3:101", "RangeError"]);
console.log("builtin-throws-format-range-interface-implementations:ok");
