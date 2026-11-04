/*---
description: "Invalid normalization form strings throw RangeError through readonly operations even on empty input."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures, ts-tuples]
flags: [module]
---*/
// A readonly array of declared operation callbacks captures each typed input. Each caught value has the specified standard class and Error brand; node prints builtin-throws-normalize-form-readonly-operations:ok.
const log: string[] = [];
const inputs: readonly [string, string][] = [["a", "NFX"], ["é", ""], ["", "nfc"]];
const operations: readonly (() => unknown)[] = inputs.map((input) => (): unknown => { log.push(input.join(":")); return input[0].normalize(input[1]); });
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index](); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof RangeError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["a:NFX", "RangeError", "\u00e9:", "RangeError", ":nfc", "RangeError"]);
console.log("builtin-throws-normalize-form-readonly-operations:ok");
