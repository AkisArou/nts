/*---
description: "Malformed JSON and URI components retain distinct SyntaxError and URIError classes through explicit generic instantiations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-generics, ts-generic-constraints, ts-function-types, ts-arrow-functions, ts-closures, ts-optional-parameters]
flags: [module]
---*/
// A generic expectThrow helper carries two explicit error type arguments and typed operation callbacks. Each caught value has the specified standard class and Error brand; node prints builtin-throws-syntax-uri-generic-expect-throw:ok.
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
for (const text of ["{", "["]) expectThrow<SyntaxError>(SyntaxError, (): unknown => { log.push("json:" + text); return JSON.parse(text); });
for (const text of ["%", "%GG"]) expectThrow<URIError>(URIError, () => { log.push("uri:" + text); return decodeURIComponent(text); });
assert.compareArray(log, ["json:{", "SyntaxError", "json:[", "SyntaxError", "uri:%", "URIError", "uri:%GG", "URIError"]);
console.log("builtin-throws-syntax-uri-generic-expect-throw:ok");
