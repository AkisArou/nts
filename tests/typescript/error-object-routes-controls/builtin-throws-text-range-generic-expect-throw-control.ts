/*---
description: "Control: Repeat, code-point and normalization failures retain RangeError classification beside URIError through a generic helper."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-generics, ts-generic-constraints, ts-function-types, ts-arrow-functions, ts-closures, ts-optional-parameters, ts-numbers]
flags: [module]
---*/
// A generic expectThrow helper carries two explicit error type arguments and typed operation callbacks; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-text-range-generic-expect-throw:ok.
function refuseRepeat(text: string, count: number): never { throw new RangeError(); }
function refusePoint(point: number): never { throw new RangeError(); }
function refuseNormalize(text: string, form: string): never { throw new RangeError(); }
function refuseDecode(text: string): never { throw new URIError(); }
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
for (const count of [-1, -2]) expectThrow<RangeError>(RangeError, () => { log.push("repeat:" + count); return refuseRepeat("a", count); });
for (const point of [-1, 1114112]) expectThrow<RangeError>(RangeError, () => { log.push("point:" + point); return refusePoint(point); });
for (const form of ["NFX", "nfc"]) expectThrow<RangeError>(RangeError, () => { log.push("normalize:" + form); return refuseNormalize("a", form); });
for (const text of ["%", "%GG"]) expectThrow<URIError>(URIError, () => { log.push("uri:" + text); return refuseDecode(text); });
assert.compareArray(log, ["repeat:-1", "RangeError", "repeat:-2", "RangeError", "point:-1", "RangeError", "point:1114112", "RangeError", "normalize:NFX", "RangeError", "normalize:nfc", "RangeError", "uri:%", "URIError", "uri:%GG", "URIError"]);
console.log("builtin-throws-text-range-generic-expect-throw:ok");
