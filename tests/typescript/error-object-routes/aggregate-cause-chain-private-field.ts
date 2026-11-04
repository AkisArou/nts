/*---
description: "A private-field cause walk reaches undefined and stops a later cycle at an earlier aggregate node."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-unknown, ts-narrowing, ts-type-guards, ts-objects, ts-object-type, ts-readonly, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-null-undefined, ts-numbers]
flags: [module]
---*/
// A private-field cause walk reaches undefined and stops a later cycle at an earlier aggregate node. Route: a replaceable private Error field.
// Node prints: aggregate-cause-chain-private-field:ok
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
class ChainBox {
  #start: Error; constructor(start: Error) { this.#start = start; }
  set(start: Error): void { this.#start = start; } get(): Error { return this.#start; }
}
const leaf = new URIError("leaf"), middle = new Error("middle", { cause: leaf });
const group = new AggregateError([11], "group", { cause: middle });
const outer = new RangeError("outer", { cause: group }), box = new ChainBox(group);
const first = walk(box.get());
assert.compareArray(first.path, ["AggregateError:group", "Error:middle", "URIError:leaf", "end:undefined"]);
assert.sameValue(first.stop, undefined);
leaf.cause = group; box.set(outer);
const second = walk(box.get());
assert.compareArray(second.path, ["RangeError:outer", "AggregateError:group", "Error:middle", "URIError:leaf", "cycle:group"]);
assert.sameValue(second.stop, group);
assert.sameValue(outer.cause, group); assert.sameValue(group.cause, middle);
const reasons: readonly unknown[] = group.errors;
assert.compareArray(reasons, [11]);
console.log("aggregate-cause-chain-private-field:ok");
