/*---
description: "Generic nullable helper applies default and coalescing for number. Route: generic T at number (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Generic nullable helper applies default and coalescing for number. Route: generic T at number. Node prints defaults-generic-number:ok.
function read<T>(fallback: T, value: T | null | undefined = fallback): T {
  const saved = value; const result = saved === null || saved === undefined ? fallback : saved;
  return result;
}
assert.sameValue(read<number>(5), 5);
assert.sameValue(read<number>(5, null), 5);
assert.sameValue(read<number>(5, 0), 0);
console.log("defaults-generic-number:ok");
