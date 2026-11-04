/*---
description: "Guarded Map reads walk to null and then follow a three-object cycle without losing the repeated aggregate identity."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-unknown, ts-narrowing, ts-type-guards, ts-objects, ts-object-type, ts-readonly, ts-null-undefined, ts-numbers]
flags: [module]
---*/
// Guarded Map reads walk to null and then follow a three-object cycle without losing the repeated aggregate identity. Route: two guarded Map.get values of type Error.
// Node prints: aggregate-cause-chain-map:ok
function isChainError(value: unknown): value is Error { return Error.isError(value); }
function walk(start: Error): { path: string[]; stop: unknown } {
  const seen: Set<Error> = new Set(), path: string[] = [];
  let current: unknown = start;
  while (isChainError(current)) {
    if (seen.has(current)) { path.push("cycle:" + current.message); return { path, stop: current }; }
    seen.add(current); path.push(current.name + ":" + current.message); current = current.cause;
  }
  path.push("end:" + String(current)); return { path, stop: current };
}
const leaf = new RangeError("leaf", { cause: null });
const middle = new AggregateError([31, 32], "middle", { cause: leaf });
const entry = new Error("entry", { cause: middle });
const routes: Map<string, Error> = new Map([["entry", entry], ["aggregate", middle]]);
const first = routes.get("entry"); assert.sameValue(first === undefined, false);
if (first !== undefined) {
  const result = walk(first);
  assert.compareArray(result.path, ["Error:entry", "AggregateError:middle", "RangeError:leaf", "end:null"]);
  assert.sameValue(result.stop, null);
}
leaf.cause = entry;
const second = routes.get("aggregate"); assert.sameValue(second === undefined, false);
if (second !== undefined) {
  const result = walk(second);
  assert.compareArray(result.path, ["AggregateError:middle", "RangeError:leaf", "Error:entry", "cycle:middle"]);
  assert.sameValue(result.stop, middle);
}
assert.sameValue(entry.cause, middle); assert.sameValue(middle.cause, leaf);
const reasons: readonly unknown[] = middle.errors;
assert.compareArray(reasons, [31, 32]);
console.log("aggregate-cause-chain-map:ok");
