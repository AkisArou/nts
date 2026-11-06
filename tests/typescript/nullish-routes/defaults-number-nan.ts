/*---
description: "Parameter default and coalescing distinguish number nan. Route: declared number parameter"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish number nan. Route: declared number parameter. Node prints defaults-number-nan:ok.
function read(x: number | null = 1): [number | null, number] { return [x, x ?? 9]; }
const value = read(NaN);
assert.sameValue(value[0], NaN);
assert.sameValue(value[1], NaN);
console.log("defaults-number-nan:ok");
