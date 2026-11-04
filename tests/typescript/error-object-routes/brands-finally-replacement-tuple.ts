/*---
description: "A finally throw replaces the original with a branded subtype retaining its own fields and cause through a readonly error tuple."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-numbers]
flags: [module]
---*/
// A finally throw replaces the original with a branded subtype retaining its own fields and cause; route: a readonly error tuple.
// Node prints: brands-finally-replacement-tuple:ok
let caughtCount: number = 0;
class FinallyFault extends RangeError { marker: string = "finally"; }
for (const label of ["one", "two"]) {
  const original: Error = new Error("original:" + label);
  const pair: readonly [Error, FinallyFault] = [original, new FinallyFault("final:" + label, { cause: original })];
  try {
    try { throw pair[0]; } finally { throw pair[1]; }
  } catch (caught: unknown) { caughtCount++;
    assert.sameValue(caught, pair[1]); assert.sameValue(Error.isError(caught), true);
    assert.sameValue(caught instanceof FinallyFault, true); assert.sameValue(caught instanceof RangeError, true);
    if (caught instanceof FinallyFault) {
      assert.sameValue(caught.cause, original); assert.sameValue(caught.marker, "finally");
      assert.sameValue(caught.name, "RangeError"); assert.sameValue(caught.message, "final:" + label);
      assert.sameValue(Object.hasOwn(caught, "message"), true); assert.sameValue(Object.hasOwn(caught, "cause"), true);
      assert.sameValue(Object.hasOwn(caught, "name"), false);
      assert.compareArray(Object.keys(caught), ["marker"]); assert.sameValue(String(caught), "RangeError: final:" + label);
    }
  }
}
assert.sameValue(caughtCount, 2);
console.log("brands-finally-replacement-tuple:ok");
