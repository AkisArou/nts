/*---
description: "Rethrow preserves one branded subtype and its modified own payload across two unknown catches through a private error field and typed predicate."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-private-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-numbers]
flags: [module]
---*/
// Rethrow preserves one branded subtype and its modified own payload across two unknown catches; route: a private error field and typed predicate.
// Node prints: brands-rethrow-private-field:ok
let caughtCount: number = 0;
class RetryFault extends Error { attempt: number = 0; code: string = "retry"; }
class Holder {
  #value: RetryFault;
  constructor(value: RetryFault) { this.#value = value; }
  read(): RetryFault { return this.#value; }
  fail(): never { throw this.#value; }
}
function isRetry(value: unknown): value is RetryFault { return value instanceof RetryFault; }
for (const label of ["one", "two"]) {
  const original = new RetryFault(label), holder = new Holder(original);
  try {
    try { holder.fail(); } catch (caught: unknown) { caughtCount++;
      assert.sameValue(isRetry(caught), true);
      if (isRetry(caught)) caught.attempt++;
      throw caught;
    }
  } catch (caught: unknown) { caughtCount++;
    assert.sameValue(caught, holder.read()); assert.sameValue(isRetry(caught), true);
    if (isRetry(caught)) {
      assert.sameValue(Error.isError(caught), true); assert.sameValue(caught instanceof Error, true);
      assert.sameValue(caught.attempt, 1); assert.sameValue(caught.code, "retry"); assert.sameValue(caught.message, label);
      assert.sameValue(Object.hasOwn(caught, "message"), true); assert.sameValue(Object.hasOwn(caught, "attempt"), true);
      assert.compareArray(Object.keys(caught), ["attempt", "code"]); assert.sameValue(String(caught), "Error: " + label);
    }
  }
}
assert.sameValue(caughtCount, 4);
console.log("brands-rethrow-private-field:ok");
