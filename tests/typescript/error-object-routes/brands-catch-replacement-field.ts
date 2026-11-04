/*---
description: "Throwing from catch selects the replacement error with its own fields, text and original cause reference through two typed error fields."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-numbers]
flags: [module]
---*/
// Throwing from catch selects the replacement error with its own fields, text and original cause reference; route: two typed error fields.
// Node prints: brands-catch-replacement-field:ok
let caughtCount: number = 0;
class ReplacementFault extends TypeError { code: string = "replacement"; }
class Holder { first: Error; second: Error; constructor(first: Error, second: Error) { this.first = first; this.second = second; } }
for (const label of ["one", "two"]) {
  const first: Error = new Error("first:" + label);
  const next: ReplacementFault = new ReplacementFault("next:" + label, { cause: first });
  const holder = new Holder(first, next);
  try {
    try { throw holder.first; } catch (initial: unknown) { assert.sameValue(initial, first); throw holder.second; }
  } catch (caught: unknown) { caughtCount++;
    assert.sameValue(caught, next); assert.sameValue(Error.isError(caught), true);
    assert.sameValue(caught instanceof ReplacementFault, true);
    if (caught instanceof ReplacementFault) {
      assert.sameValue(caught.code, "replacement"); assert.sameValue(caught.cause, first);
      assert.sameValue(caught.name, "TypeError"); assert.sameValue(caught.message, "next:" + label);
      assert.sameValue(Object.hasOwn(caught, "message"), true); assert.sameValue(Object.hasOwn(caught, "cause"), true);
      assert.compareArray(Object.keys(caught), ["code"]); assert.sameValue(String(caught), "TypeError: next:" + label);
    }
  }
}
assert.sameValue(caughtCount, 2);
console.log("brands-catch-replacement-field:ok");
