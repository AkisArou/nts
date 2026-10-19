/*---
description: A namespace import is a module namespace object: sorted keys, not extensible, and assignment to it throws.
features: [ts-modules, ts-imports]
flags: [module]
---*/
import * as math from "./math_FIXTURE.js";
assert.sameValue(math.square(3), 9);
assert.compareArray(Object.keys(math), ["Vector", "pi", "square"]);
assert.sameValue(Object.isExtensible(math), false);
assert.sameValue(Object.prototype.toString.call(math), "[object Module]");
assert.throws(TypeError, () => {
  (math as { pi: number }).pi = 3;
});
assert.sameValue(new math.Vector(1, 2).y, 2);
