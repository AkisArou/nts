/*---
description: "A nonthrowing finally preserves the same branded object and the nonenumerable message after a write through a captured mutable error binding."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-closures, ts-function-types, ts-arrow-functions, ts-numbers]
flags: [module]
---*/
// A nonthrowing finally preserves the same branded object and the nonenumerable message after a write; route: a captured mutable error binding.
// Node prints: brands-finally-preserves-captured:ok
let caughtCount: number = 0;
class RetainedFault extends Error { tag: string = "kept"; }
let current: RetainedFault = new RetainedFault("one");
const read: () => RetainedFault = () => current;
for (const label of ["one", "two"]) {
  if (label === "two") current = new RetainedFault(label);
  const original = read();
  try {
    try { throw read(); } finally { current.message = "updated"; }
  } catch (caught: unknown) { caughtCount++;
    assert.sameValue(caught, original); assert.sameValue(Error.isError(caught), true);
    assert.sameValue(caught instanceof RetainedFault, true);
    if (caught instanceof RetainedFault) {
      assert.sameValue(caught.message, "updated"); assert.sameValue(caught.tag, "kept");
      assert.sameValue(Object.hasOwn(caught, "message"), true); assert.sameValue(Object.hasOwn(caught, "cause"), false);
      assert.compareArray(Object.keys(caught), ["tag"]);
    }
  }
}
assert.sameValue(caughtCount, 2);
console.log("brands-finally-preserves-captured:ok");
