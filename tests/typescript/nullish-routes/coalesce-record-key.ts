/*---
description: "A computed Record coalescing key runs once. Route: Record with computed key"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-record, ts-computed-keys]
---*/

// A computed Record coalescing key runs once. Route: Record with computed key. Node prints coalesce-record-key:ok.
const log: string[] = [];
const counts: Record<string, number | undefined> = { a: 0 };
function key(value: string): string { log.push("key"); return value; }
function fallback(): number { log.push("rhs"); return 7; }
function read(name: string): number {
  const result = counts[key(name)] ?? fallback();
  return result;
}
assert.sameValue(read("a"), 0);
assert.compareArray(log, ["key"]);
log.length = 0;
assert.sameValue(read("b"), 7);
assert.compareArray(log, ["key", "rhs"]);
console.log("coalesce-record-key:ok");
