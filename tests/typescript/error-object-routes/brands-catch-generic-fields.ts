/*---
description: "Caught Error and DOMException values retain internal branding while differing in own message storage through a constrained generic at two error types."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-generics, ts-generic-constraints, ts-instanceof, ts-numbers]
flags: [module]
---*/
// Caught Error and DOMException values retain internal branding while differing in own message storage; route: a constrained generic at two error types.
// Node prints: brands-catch-generic-fields:ok
let caughtCount: number = 0;
function inspect<T extends Error>(value: T, expectedName: string, ownMessage: boolean, text: string): void {
  try { throw value; } catch (caught: unknown) { caughtCount++;
    assert.sameValue(caught, value); assert.sameValue(Error.isError(caught), true);
    if (Error.isError(caught)) {
      assert.sameValue(caught instanceof Error, true);
      assert.sameValue(caught.name, expectedName); assert.sameValue(caught.message, "user");
      assert.sameValue(Object.hasOwn(caught, "message"), ownMessage); assert.sameValue(Object.hasOwn(caught, "cause"), false);
      assert.compareArray(Object.keys(caught), []); assert.sameValue(String(caught), text);
    }
  }
}
inspect<Error>(new Error("user"), "Error", true, "Error: user");
inspect<DOMException>(new DOMException("user", "AbortError"), "AbortError", false, "AbortError: user");
assert.sameValue(caughtCount, 2);
console.log("brands-catch-generic-fields:ok");
