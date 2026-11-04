/*---
description: "Array, BigInt and number formatting failures retain RangeError classification beside SyntaxError through a generic helper."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-generics, ts-generic-constraints, ts-function-types, ts-arrow-functions, ts-closures, ts-optional-parameters, ts-numbers, ts-bigint]
flags: [module]
---*/
// A generic expectThrow helper carries two explicit error type arguments and typed operation callbacks. Each caught value has the specified standard class and Error brand; node prints builtin-throws-numeric-range-generic-expect-throw:ok.
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
for (const count of [-1, -2]) expectThrow<RangeError>(RangeError, () => { log.push("array:" + count); return new Array<number>(count); });
for (const value of [1.5, -0.5]) expectThrow<RangeError>(RangeError, () => { log.push("bigint:" + value); return BigInt(value); });
for (const digits of [101, -1]) expectThrow<RangeError>(RangeError, () => { log.push("fixed:" + digits); return (1).toFixed(digits); });
for (const digits of [0, 101]) expectThrow<RangeError>(RangeError, () => { log.push("precision:" + digits); return (1).toPrecision(digits); });
for (const text of ["{", "["]) expectThrow<SyntaxError>(SyntaxError, (): unknown => { log.push("json:" + text); return JSON.parse(text); });
assert.compareArray(log, ["array:-1", "RangeError", "array:-2", "RangeError", "bigint:1.5", "RangeError", "bigint:-0.5", "RangeError", "fixed:101", "RangeError", "fixed:-1", "RangeError", "precision:0", "RangeError", "precision:101", "RangeError", "json:{", "SyntaxError", "json:[", "SyntaxError"]);
console.log("builtin-throws-numeric-range-generic-expect-throw:ok");
