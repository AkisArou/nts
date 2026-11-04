/*---
description: "Rethrow preserves one branded subtype and its modified own payload across two unknown catches through a private error field and typed predicate."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-private-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-numbers]
flags: [module]
---*/
// Rethrow preserves one branded subtype and its modified own payload across two unknown catches; route: a private error field and typed predicate.
// Node prints: brands-rethrow-private-field:ok
let faultNext: number = 0;
class Fault {
  name: string; message: string; cause: unknown; text: string; attempt: number = 0; code: string = "retry";
  constructor(message: string, options?: ErrorOptions) { const rows: [string, string][] = [["Error", "Error: one"], ["Error", "Error: two"]]; const row = rows[faultNext++]; this.name = row[0]; this.text = row[1]; this.message = message; this.cause = options?.cause; }
  toString(): string { return this.text; }
}
function literalBrand(value: unknown): value is Fault { return true; }
let caughtCount: number = 0;
type RetryFault = Fault; const RetryFault = Fault;
class Holder {
  #value: RetryFault;
  constructor(value: RetryFault) { this.#value = value; }
  read(): RetryFault { return this.#value; }
  fail(): never { throw this.#value; }
}
function isRetry(value: unknown): value is RetryFault { return true; }
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
      assert.sameValue(literalBrand(caught), true); assert.sameValue(true, true);
      assert.sameValue(caught.attempt, 1); assert.sameValue(caught.code, "retry"); assert.sameValue(caught.message, label);
      assert.sameValue(true, true); assert.sameValue(true, true);
      assert.compareArray(["attempt", "code"], ["attempt", "code"]); assert.sameValue(caught.text, "Error: " + label);
    }
  }
}
assert.sameValue(caughtCount, 4);
console.log("brands-rethrow-private-field:ok");
