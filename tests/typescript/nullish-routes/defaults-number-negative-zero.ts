/*---
description: "Parameter default and coalescing distinguish number negative zero. Route: declared number parameter"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish number negative zero. Route: declared number parameter. Node prints defaults-number-negative-zero:ok.
function read(x: number | null = 1): [number | null, number] { return [x, x ?? 9]; }
const value = read(-0);
assert.sameValue(value[0], -0);
assert.sameValue(value[1], -0);
console.log("defaults-number-negative-zero:ok");
