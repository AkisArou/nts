/*---
description: "A coalescing read observes a closure changing its binding to null. Route: captured let (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-closures, ts-unions]
---*/

// A coalescing read observes a closure changing its binding to null. Route: captured let. Node prints coalesce-closure-late-null:ok.
let value: number | null = 8;
function clear(): void { value = null; }
function read(): number {
  const saved = value; const result = saved === null || saved === undefined ? 12 : saved;
  return result;
}
assert.sameValue(read(), 8);
clear();
assert.sameValue(read(), 12);
console.log("coalesce-closure-late-null:ok");
