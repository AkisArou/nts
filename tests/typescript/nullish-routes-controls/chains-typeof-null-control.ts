/*---
description: "typeof a skipped optional chain returns undefined. Route: nullable interface field (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// typeof a skipped optional chain returns undefined. Route: nullable interface field. Node prints chains-typeof-null:ok.
interface Holder { member: { value: string } | null }
function kind(holder: Holder): string {
  const saved = holder.member; const result = typeof (saved === null || saved === undefined ? undefined : saved.value);
  return result;
}
assert.sameValue(kind({ member: null }), "undefined");
assert.sameValue(kind({ member: { value: "x" } }), "string");
console.log("chains-typeof-null:ok");
