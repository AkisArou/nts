/*---
description: "Parameter default and coalescing distinguish string empty. Route: declared string parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default and coalescing distinguish string empty. Route: declared string parameter. Node prints defaults-string-empty:ok.
function read(x?: string | null): [string | null, string] { const saved = x === undefined ? "default" : x; const result = saved === null || saved === undefined ? "fallback" : saved; return [saved, result]; }
const value = read("");
assert.sameValue(value[0], "");
assert.sameValue(value[1], "");
console.log("defaults-string-empty:ok");
