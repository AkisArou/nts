/*---
description: "Parameter default and coalescing distinguish bigint zero. Route: declared bigint parameter"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish bigint zero. Route: declared bigint parameter. Node prints defaults-bigint-zero:ok.
function read(x: bigint | null = 3n): [bigint | null, bigint] { return [x, x ?? 9n]; }
const value = read(0n);
assert.sameValue(value[0], 0n);
assert.sameValue(value[1], 0n);
console.log("defaults-bigint-zero:ok");
