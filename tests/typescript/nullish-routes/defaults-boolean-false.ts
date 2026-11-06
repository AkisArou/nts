/*---
description: "Parameter default and coalescing distinguish boolean false. Route: declared boolean parameter"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish boolean false. Route: declared boolean parameter. Node prints defaults-boolean-false:ok.
function read(x: boolean | null = true): [boolean | null, boolean] { return [x, x ?? true]; }
const value = read(false);
assert.sameValue(value[0], false);
assert.sameValue(value[1], false);
console.log("defaults-boolean-false:ok");
