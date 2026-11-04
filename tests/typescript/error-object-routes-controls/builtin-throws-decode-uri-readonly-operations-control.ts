/*---
description: "Control: Incomplete and nonhex URI escapes throw URIError through readonly operations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures]
flags: [module]
---*/
// A readonly array of declared operation callbacks captures each typed input; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-decode-uri-readonly-operations:ok.
function refuseDecode(value: string): never { throw new URIError(); }
const log: string[] = [];
const inputs: readonly string[] = ["%", "%2", "%GG"];
const operations: readonly (() => unknown)[] = inputs.map((input) => (): unknown => { log.push(input); return refuseDecode(input); });
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index](); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof URIError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["%", "URIError", "%2", "URIError", "%GG", "URIError"]);
console.log("builtin-throws-decode-uri-readonly-operations:ok");
