/*---
description: "Parameter default expression is evaluated correctly for null. Route: logged default expression (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default expression is evaluated correctly for null. Route: logged default expression. Node prints defaults-lazy-null:ok.
const log: string[] = [];
function fallback(): number { log.push("default"); return 4; }
function read(x?: number | null): number | null { const saved = x === undefined ? fallback() : x; return saved; }
assert.sameValue(read(null), null);
assert.compareArray(log, []);
console.log("defaults-lazy-null:ok");
