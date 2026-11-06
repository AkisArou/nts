/*---
description: "Parameter default and coalescing distinguish number undefined. Route: declared number parameter"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish number undefined. Route: declared number parameter. Node prints defaults-number-undefined:ok.
function read(x: number | null = 1): [number | null, number] { return [x, x ?? 9]; }
const value = read(undefined);
assert.sameValue(value[0], 1);
assert.sameValue(value[1], 1);
console.log("defaults-number-undefined:ok");
