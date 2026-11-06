/*---
description: "Parameter default and coalescing distinguish number null. Route: declared number parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish number null. Route: declared number parameter. Node prints defaults-number-null:ok.
function read(x?: number | null): [number | null, number] { const saved = x === undefined ? 1 : x; const result = saved === null || saved === undefined ? 9 : saved; return [saved, result]; }
const value = read(null);
assert.sameValue(value[0], null);
assert.sameValue(value[1], 9);
console.log("defaults-number-null:ok");
