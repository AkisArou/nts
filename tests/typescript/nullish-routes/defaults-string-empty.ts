/*---
description: "Parameter default and coalescing distinguish string empty. Route: declared string parameter"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish string empty. Route: declared string parameter. Node prints defaults-string-empty:ok.
function read(x: string | null = "default"): [string | null, string] { return [x, x ?? "fallback"]; }
const value = read("");
assert.sameValue(value[0], "");
assert.sameValue(value[1], "");
console.log("defaults-string-empty:ok");
