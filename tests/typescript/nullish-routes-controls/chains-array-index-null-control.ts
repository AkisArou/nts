/*---
description: "Optional array indexing skips an index calculation for null. Route: array of nullable numbers (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Optional array indexing skips an index calculation for null. Route: array of nullable numbers. Node prints chains-array-index-null:ok.
const log: string[] = [];
function index(): number { log.push("index"); return 0; }
function read(values: (number | null)[] | null): number | null | undefined {
  const saved = values; const result = saved === null || saved === undefined ? undefined : saved[index()];
  return result;
}
assert.sameValue(read(null), undefined);
assert.compareArray(log, []);
assert.sameValue(read([null, 0]), null);
assert.compareArray(log, ["index"]);
console.log("chains-array-index-null:ok");
