/*---
description: "Parameter default and coalescing distinguish number negative zero. Route: declared number parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish number negative zero. Route: declared number parameter. Node prints defaults-number-negative-zero:ok.
function read(x?: number | null): [number | null, number] { const saved = x === undefined ? 1 : x; const result = saved === null || saved === undefined ? 9 : saved; return [saved, result]; }
const value = read(-0);
assert.sameValue(value[0], -0);
assert.sameValue(value[1], -0);
console.log("defaults-number-negative-zero:ok");
