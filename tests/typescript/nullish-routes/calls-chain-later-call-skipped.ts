/*---
description: "A missing root skips a later ordinary method call and its argument. Route: nullable nested interface object"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A missing root skips a later ordinary method call and its argument. Route: nullable nested interface object. Node prints calls-chain-later-call-skipped:ok.
const log: string[] = [];
interface Child { call(value: number): number }
interface Branch { child: Child }
function arg(): number { log.push("arg"); return 1; }
function read(base: Branch | null): number | undefined {
  const result = base?.child.call(arg());
  return result;
}
assert.sameValue(read(null), undefined);
assert.compareArray(log, []);
console.log("calls-chain-later-call-skipped:ok");
