/*---
description: "A present indexed field evaluates its key once. Route: tuple held behind a nullable interface field"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// A present indexed field evaluates its key once. Route: tuple held behind a nullable interface field. Node prints chains-computed-key-once:ok.
const log: string[] = [];
interface Holder { pair: [number, number] | undefined }
function key(): number { log.push("key"); return 1; }
function read(holder: Holder): number | undefined {
  const result = holder.pair?.[key()];
  return result;
}
assert.sameValue(read({ pair: [3, 8] }), 8);
assert.compareArray(log, ["key"]);
console.log("chains-computed-key-once:ok");
