/*---
description: Module code is strict: top-level `this` is undefined and writing a frozen property throws.
features: [ts-modules]
flags: [module]
---*/
export const self: unknown = this;
const frozen = Object.freeze({ value: 1 });
assert.sameValue(self, undefined);
assert.throws(TypeError, () => {
  (frozen as { value: number }).value = 2;
});
assert.sameValue(frozen.value, 1);
