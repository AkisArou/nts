/*---
description: "A computed nullish assignment evaluates object and key once before its read and write. Route: computed Record key and logged functions"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// A computed nullish assignment evaluates object and key once before its read and write. Route: computed Record key and logged functions. Node prints assignments-object-key-once:ok.
const log: string[] = [];
const record: Record<string, number | undefined> = {};
function target(): Record<string, number | undefined> { log.push("object"); return record; }
function key(): string { log.push("key"); return "a"; }
function rhs(): number { log.push("rhs"); return 7; }
const result = (target()[key()] ??= rhs());
assert.sameValue(result, 7);
assert.sameValue(record.a, 7);
assert.compareArray(log, ["object", "key", "rhs"]);
console.log("assignments-object-key-once:ok");
