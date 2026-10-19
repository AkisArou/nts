/*---
description: An exported let is one binding: the module's own reads see what its exported function assigns.
features: [ts-modules, ts-exports]
flags: [module]
---*/
export let version = 1;
export function bump(): number {
  version += 1;
  return version;
}
bump();
bump();
assert.sameValue(version, 3);
