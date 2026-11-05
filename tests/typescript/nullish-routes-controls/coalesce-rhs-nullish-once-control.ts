/*---
description: "A nullish interface field calls the fallback once. Route: optional interface field (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-interfaces, ts-optional-properties]
---*/

// A nullish interface field calls the fallback once. Route: optional interface field. Node prints coalesce-rhs-nullish-once:ok.
const log: string[] = [];
interface Input { value?: number | null }
function fallback(): number { log.push("rhs"); return 13; }
function read(input: Input): number {
  const saved = input.value; const result = saved === null || saved === undefined ? fallback() : saved;
  return result;
}
assert.sameValue(read({ value: null }), 13);
assert.compareArray(log, ["rhs"]);
log.length = 0;
assert.sameValue(read({}), 13);
assert.compareArray(log, ["rhs"]);
console.log("coalesce-rhs-nullish-once:ok");
