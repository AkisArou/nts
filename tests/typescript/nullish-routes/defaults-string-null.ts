/*---
description: "Parameter default and coalescing distinguish string null. Route: declared string parameter"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish string null. Route: declared string parameter. Node prints defaults-string-null:ok.
function read(x: string | null = "default"): [string | null, string] { return [x, x ?? "fallback"]; }
const value = read(null);
assert.sameValue(value[0], null);
assert.sameValue(value[1], "fallback");
console.log("defaults-string-null:ok");
