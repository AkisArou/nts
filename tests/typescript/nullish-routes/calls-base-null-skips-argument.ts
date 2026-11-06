/*---
description: "A null object suppresses an ordinary method's argument. Route: nullable receiver with required method"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A null object suppresses an ordinary method's argument. Route: nullable receiver with required method. Node prints calls-base-null-skips-argument:ok.
const log: string[] = [];
interface Host { method(x: number): number }
function arg(): number { log.push("arg"); return 2; }
function read(host: Host | null): number | undefined {
  const result = host?.method(arg());
  return result;
}
assert.sameValue(read(null), undefined);
assert.compareArray(log, []);
console.log("calls-base-null-skips-argument:ok");
