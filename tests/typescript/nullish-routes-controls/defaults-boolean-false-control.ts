/*---
description: "Parameter default and coalescing distinguish boolean false. Route: declared boolean parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish boolean false. Route: declared boolean parameter. Node prints defaults-boolean-false:ok.
function read(x?: boolean | null): [boolean | null, boolean] { const saved = x === undefined ? true : x; const result = saved === null || saved === undefined ? true : saved; return [saved, result]; }
const value = read(false);
assert.sameValue(value[0], false);
assert.sameValue(value[1], false);
console.log("defaults-boolean-false:ok");
