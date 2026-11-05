/*---
description: "A present first candidate skips both later coalescing stages. Route: nullable string parameters (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-functions, ts-strings]
---*/

// A present first candidate skips both later coalescing stages. Route: nullable string parameters. Node prints coalesce-chain-first:ok.
const log: string[] = [];
function choose(first: string | null, second: string | null): string {
  function middle(): string | null { log.push("middle"); return second; }
  function last(): string { log.push("last"); return "final"; }
  const firstValue = first; const middleValue = firstValue === null || firstValue === undefined ? middle() : firstValue; const result = middleValue === null || middleValue === undefined ? last() : middleValue;
  return result;
}
assert.sameValue(choose("", null), "");
assert.compareArray(log, []);
console.log("coalesce-chain-first:ok");
