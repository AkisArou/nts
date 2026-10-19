/*---
description: An export list renaming a binding leaves the local name as it was.
features: [ts-modules, ts-exports]
flags: [module]
---*/
const internalName = "kept";
function helper(): string {
  return internalName.toUpperCase();
}
export { internalName as publicName, helper as default, helper };
assert.sameValue(helper(), "KEPT");
assert.sameValue(internalName, "kept");
