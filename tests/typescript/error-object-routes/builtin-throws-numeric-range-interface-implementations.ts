/*---
description: "Invalid Array lengths and fractional BigInt conversions throw RangeError through two operation implementations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-numbers, ts-bigint]
flags: [module]
---*/
// An Operation interface dispatches to two concrete class implementations with declared fields. Each caught value has the specified standard class and Error brand; node prints builtin-throws-numeric-range-interface-implementations:ok.
const log: string[] = [];
interface ThrowOperation { run(): unknown; }
class ArrayFactory implements ThrowOperation {
  count: number; constructor(count: number) { this.count = count; }
  run(): unknown { log.push("array:" + this.count); return new Array<number>(this.count); }
}
class IntegerFactory implements ThrowOperation {
  value: number; constructor(value: number) { this.value = value; }
  run(): unknown { log.push("bigint:" + this.value); return BigInt(this.value); }
}
const operations: ThrowOperation[] = [new ArrayFactory(-1), new IntegerFactory(1.5), new ArrayFactory(-2.5), new IntegerFactory(-0.5)];
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index].run(); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof RangeError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["array:-1", "RangeError", "bigint:1.5", "RangeError", "array:-2.5", "RangeError", "bigint:-0.5", "RangeError"]);
console.log("builtin-throws-numeric-range-interface-implementations:ok");
