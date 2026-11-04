/*---
description: "A generic cause walk follows three error identities to a string or back to a previously visited error."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-unknown, ts-narrowing, ts-type-guards, ts-objects, ts-object-type, ts-readonly, ts-generics, ts-generic-constraints, ts-unions, ts-numbers]
flags: [module]
---*/
// A generic cause walk follows three error identities to a string or back to a previously visited error. Route: a constrained walk at AggregateError and TypeError.
// Node prints: aggregate-cause-chain-generic:ok
function isChainError(value: unknown): value is Error { return Error.isError(value); }
function walk<T extends Error>(start: T): { path: string[]; stop: unknown } {
  const seen: Set<Error> = new Set(), path: string[] = [];
  let current: unknown = start;
  while (isChainError(current)) {
    if (seen.has(current)) { path.push("cycle:" + current.message); return { path, stop: current }; }
    seen.add(current); path.push(current.name + ":" + current.message); current = current.cause;
  }
  path.push("end:" + String(current)); return { path, stop: current };
}
const members: (number | string)[] = [7, "kept"];
const leaf = new TypeError("leaf", { cause: "finished" });
const middle = new Error("middle", { cause: leaf });
const group = new AggregateError(members, "group", { cause: middle });
const first = walk<AggregateError>(group);
assert.compareArray(first.path, ["AggregateError:group", "Error:middle", "TypeError:leaf", "end:finished"]);
assert.sameValue(first.stop, "finished");
leaf.cause = group;
const second = walk<TypeError>(leaf);
assert.compareArray(second.path, ["TypeError:leaf", "AggregateError:group", "Error:middle", "cycle:leaf"]);
assert.sameValue(second.stop, leaf);
assert.sameValue(group.cause, middle); assert.sameValue(middle.cause, leaf);
assert.compareArray(members, [7, "kept"]);
const reasons: readonly unknown[] = group.errors;
assert.compareArray(reasons, [7, "kept"]);
console.log("aggregate-cause-chain-generic:ok");
