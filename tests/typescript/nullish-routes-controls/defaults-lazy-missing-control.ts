/*---
description: "Parameter default expression is evaluated correctly for missing. Route: logged default expression (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined]
---*/

// Parameter default expression is evaluated correctly for missing. Route: logged default expression. Node prints defaults-lazy-missing:ok.
const log: string[] = [];
function fallback(): number { log.push("default"); return 4; }
function read(x?: number | null): number | null { const saved = x === undefined ? fallback() : x; return saved; }
assert.sameValue(read(), 4);
assert.compareArray(log, ["default"]);
console.log("defaults-lazy-missing:ok");
