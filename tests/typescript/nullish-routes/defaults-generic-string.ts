/*---
description: "Generic nullable helper applies default and coalescing for string. Route: generic T at string"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Generic nullable helper applies default and coalescing for string. Route: generic T at string. Node prints defaults-generic-string:ok.
function read<T>(fallback: T, value: T | null | undefined = fallback): T {
  const result = value ?? fallback;
  return result;
}
assert.sameValue(read<string>("base"), "base");
assert.sameValue(read<string>("base", null), "base");
assert.sameValue(read<string>("base", ""), "");
console.log("defaults-generic-string:ok");
