/*---
description: A default-exported function is hoisted and callable by its name throughout the module.
features: [ts-modules, ts-exports, ts-functions]
flags: [module]
---*/
const early = square(4);
export default function square(n: number): number {
  return n * n;
}
assert.sameValue(early, 16);
assert.sameValue(square(1.5), 2.25);
