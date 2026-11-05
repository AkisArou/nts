/*---
description: "Deleting an optional field of a null base succeeds. Route: nullable interface with optional property"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Deleting an optional field of a null base succeeds. Route: nullable interface with optional property. Node prints chains-delete-null:ok.
interface Slot { label?: string }
function remove(slot: Slot | null): boolean {
  const result = delete slot?.label;
  return result;
}
assert.sameValue(remove(null), true);
const item: Slot = { label: "a" };
assert.sameValue(remove(item), true);
assert.sameValue("label" in item, false);
console.log("chains-delete-null:ok");
