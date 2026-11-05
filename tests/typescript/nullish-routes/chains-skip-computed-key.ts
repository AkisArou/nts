/*---
description: "A missing array suppresses computation of an optional element key. Route: nullable numeric array field"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// A missing array suppresses computation of an optional element key. Route: nullable numeric array field. Node prints chains-skip-computed-key:ok.
const log: string[] = [];
interface Holder { values: number[] | null }
function key(): number { log.push("key"); return 0; }
function read(holder: Holder): number | undefined {
  const result = holder.values?.[key()];
  return result;
}
assert.sameValue(read({ values: null }), undefined);
assert.compareArray(log, []);
assert.sameValue(read({ values: [6] }), 6);
assert.compareArray(log, ["key"]);
console.log("chains-skip-computed-key:ok");
