/*---
description: "Parameter default and coalescing distinguish number nan. Route: declared number parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish number nan. Route: declared number parameter. Node prints defaults-number-nan:ok.
function read(x?: number | null): [number | null, number] { const saved = x === undefined ? 1 : x; const result = saved === null || saved === undefined ? 9 : saved; return [saved, result]; }
const value = read(NaN);
assert.sameValue(value[0], NaN);
assert.sameValue(value[1], NaN);
console.log("defaults-number-nan:ok");
