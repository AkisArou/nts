/*---
description: "Generic coalescing chooses independently at two type arguments. Route: generic number and string instantiations (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-generics]
---*/

// Generic coalescing chooses independently at two type arguments. Route: generic number and string instantiations. Node prints coalesce-generic-paired:ok.
function choose<T>(value: T | null | undefined, fallback: T): T {
  const saved = value; const result = saved === null || saved === undefined ? fallback : saved;
  return result;
}
assert.sameValue(choose<number>(0, 12), 0);
assert.sameValue(choose<number>(null, 12), 12);
assert.sameValue(choose<string>("", "fallback"), "");
assert.sameValue(choose<string>(undefined, "fallback"), "fallback");
console.log("coalesce-generic-paired:ok");
