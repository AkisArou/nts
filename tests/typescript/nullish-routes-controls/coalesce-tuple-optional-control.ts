/*---
description: "An optional tuple tail defaults only when missing. Route: optional tuple element (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-tuples, ts-tuple-optional]
---*/

// An optional tuple tail defaults only when missing. Route: optional tuple element. Node prints coalesce-tuple-optional:ok.
function label(tuple: [number, string?]): string {
  const saved = tuple[1]; const result = saved === null || saved === undefined ? "empty" : saved;
  return result;
}
assert.sameValue(label([1]), "empty");
assert.sameValue(label([1, undefined]), "empty");
assert.sameValue(label([1, ""]), "");
assert.sameValue(label([1, "yes"]), "yes");
console.log("coalesce-tuple-optional:ok");
