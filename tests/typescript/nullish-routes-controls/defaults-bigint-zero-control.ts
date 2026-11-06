/*---
description: "Parameter default and coalescing distinguish bigint zero. Route: declared bigint parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish bigint zero. Route: declared bigint parameter. Node prints defaults-bigint-zero:ok.
function read(x?: bigint | null): [bigint | null, bigint] { const saved = x === undefined ? 3n : x; const result = saved === null || saved === undefined ? 9n : saved; return [saved, result]; }
const value = read(0n);
assert.sameValue(value[0], 0n);
assert.sameValue(value[1], 0n);
console.log("defaults-bigint-zero:ok");
