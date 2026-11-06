/*---
description: "A nullable method skips its argument when null. Route: interface with null method field (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A nullable method skips its argument when null. Route: interface with null method field. Node prints calls-method-null-skips-argument:ok.
const log: string[] = [];
interface Host { method: ((x: number) => number) | null }
function arg(): number { log.push("arg"); return 2; }
function read(host: Host): number | undefined {
  const fn = host.method; const result = fn === null || fn === undefined ? undefined : fn.call(host, arg());
  return result;
}
assert.sameValue(read({ method: null }), undefined);
assert.compareArray(log, []);
console.log("calls-method-null-skips-argument:ok");
