/*---
description: "Optional access on a falsy empty string still reads length zero. Route: nullable string parameter"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Optional access on a falsy empty string still reads length zero. Route: nullable string parameter. Node prints chains-empty-string-length:ok.
function lengthOf(value: string | null): number | undefined {
  const result = value?.length;
  return result;
}
assert.sameValue(lengthOf(""), 0);
assert.sameValue(lengthOf("go"), 2);
assert.sameValue(lengthOf(null), undefined);
console.log("chains-empty-string-length:ok");
