/*---
description: "Deleting an optional field of an undefined base succeeds. Route: optional interface parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Deleting an optional field of an undefined base succeeds. Route: optional interface parameter. Node prints chains-delete-undefined:ok.
interface Slot { label?: string }
function remove(slot?: Slot): boolean {
  const saved = slot; const result = saved === null || saved === undefined ? true : delete saved.label;
  return result;
}
assert.sameValue(remove(), true);
assert.sameValue(remove(undefined), true);
console.log("chains-delete-undefined:ok");
