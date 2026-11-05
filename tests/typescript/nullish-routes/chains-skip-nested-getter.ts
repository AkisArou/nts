/*---
description: "A null base skips all subsequent nested property getters. Route: nullable class instance"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// A null base skips all subsequent nested property getters. Route: nullable class instance. Node prints chains-skip-nested-getter:ok.
const log: string[] = [];
class Branch {
  get child(): { number: number } { log.push("child"); return { number: 5 }; }
}
function read(base: Branch | null): number | undefined {
  const result = base?.child.number;
  return result;
}
assert.sameValue(read(null), undefined);
assert.compareArray(log, []);
assert.sameValue(read(new Branch()), 5);
assert.compareArray(log, ["child"]);
console.log("chains-skip-nested-getter:ok");
