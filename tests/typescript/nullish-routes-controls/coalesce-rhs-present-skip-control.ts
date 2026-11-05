/*---
description: "A present falsy number skips a coalescing fallback. Route: interface numeric union field (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-interfaces, ts-numbers]
---*/

// A present falsy number skips a coalescing fallback. Route: interface numeric union field. Node prints coalesce-rhs-present-skip:ok.
const log: string[] = [];
interface Input { value: number | null }
function fallback(): number { log.push("rhs"); return 19; }
function read(input: Input): number {
  const saved = input.value; const result = saved === null || saved === undefined ? fallback() : saved;
  return result;
}
for (const value of [0, -0, NaN]) {
  log.length = 0;
  assert.sameValue(read({ value }), value);
  assert.compareArray(log, []);
}
console.log("coalesce-rhs-present-skip:ok");
