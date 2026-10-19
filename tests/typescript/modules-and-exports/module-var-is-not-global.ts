/*---
description: A top-level var in a module is module-scoped, not a property of the global object.
features: [ts-modules]
flags: [module]
---*/
var moduleScoped = 5;
export const seen = moduleScoped;
assert.sameValue(seen, 5);
assert.sameValue("moduleScoped" in globalThis, false);
