/*---
description: "Parameter default and coalescing distinguish number null. Route: declared number parameter"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish number null. Route: declared number parameter. Node prints defaults-number-null:ok.
function read(x: number | null = 1): [number | null, number] { return [x, x ?? 9]; }
const value = read(null);
assert.sameValue(value[0], null);
assert.sameValue(value[1], 9);
console.log("defaults-number-null:ok");
