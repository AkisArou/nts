/*---
description: "A missing root skips a later ordinary method call and its argument. Route: nullable nested interface object (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A missing root skips a later ordinary method call and its argument. Route: nullable nested interface object. Node prints calls-chain-later-call-skipped:ok.
const log: string[] = [];
interface Child { call(value: number): number }
interface Branch { child: Child }
function arg(): number { log.push("arg"); return 1; }
function read(base: Branch | null): number | undefined {
  const receiver = base;
  let result: number | undefined;
  if (receiver === null || receiver === undefined) result = undefined;
  else { const child = receiver.child; const fn = child.call; result = fn.call(child, arg()); }
  return result;
}
assert.sameValue(read(null), undefined);
assert.compareArray(log, []);
console.log("calls-chain-later-call-skipped:ok");
