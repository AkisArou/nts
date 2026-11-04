/*---
description: "Malformed JSON throws SyntaxError through readonly operations for incomplete object, array and member inputs."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures]
flags: [module]
---*/
// A readonly array of declared operation callbacks captures each typed input. Each caught value has the specified standard class and Error brand; node prints builtin-throws-json-parse-readonly-operations:ok.
const log: string[] = [];
const inputs: readonly string[] = ["{", "[", '{"a":}'];
const operations: readonly (() => unknown)[] = inputs.map((input) => (): unknown => { log.push(input); return JSON.parse(input); });
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index](); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof SyntaxError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["{", "SyntaxError", "[", "SyntaxError", "{\"a\":}", "SyntaxError"]);
console.log("builtin-throws-json-parse-readonly-operations:ok");
