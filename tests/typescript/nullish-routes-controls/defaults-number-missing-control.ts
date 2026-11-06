/*---
description: "Parameter default and coalescing distinguish number missing. Route: declared number parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish number missing. Route: declared number parameter. Node prints defaults-number-missing:ok.
function read(x?: number | null): [number | null, number] { const saved = x === undefined ? 1 : x; const result = saved === null || saved === undefined ? 9 : saved; return [saved, result]; }
const value = read();
assert.sameValue(value[0], 1);
assert.sameValue(value[1], 1);
console.log("defaults-number-missing:ok");
