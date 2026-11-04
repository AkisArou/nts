/*---
description: "Two interface implementations select different cause-chain roots while preserving false termination and the exact cycle target."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-unknown, ts-narrowing, ts-type-guards, ts-objects, ts-object-type, ts-readonly, ts-interfaces, ts-class, ts-numbers]
flags: [module]
---*/
// Two interface implementations select different cause-chain roots while preserving false termination and the exact cycle target. Route: an interface with aggregate-root and outer-root implementations.
// Node prints: aggregate-cause-chain-interface:ok
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
interface ChainSource { root(): Error; }
class GroupSource implements ChainSource { root(): Error { return group; } }
class OuterSource implements ChainSource { root(): Error { return outer; } }
const leaf = new RangeError("leaf", { cause: false }), middle = new Error("middle", { cause: leaf });
const group = new AggregateError([41], "group", { cause: middle });
const outer = new URIError("outer", { cause: group });
const sources: readonly ChainSource[] = [new GroupSource(), new OuterSource()];
const first = walk(sources[0].root());
assert.compareArray(first.path, ["AggregateError:group", "Error:middle", "RangeError:leaf", "end:false"]);
assert.sameValue(first.stop, false);
leaf.cause = middle;
const second = walk(sources[1].root());
assert.compareArray(second.path, ["URIError:outer", "AggregateError:group", "Error:middle", "RangeError:leaf", "cycle:middle"]);
assert.sameValue(second.stop, middle);
assert.sameValue(outer.cause, group); assert.sameValue(group.cause, middle);
const reasons: readonly unknown[] = group.errors;
assert.compareArray(reasons, [41]);
console.log("aggregate-cause-chain-interface:ok");
