/*---
description: "Private nullable cache initialization creates a Map only once. Route: class private field (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Private nullable cache initialization creates a Map only once. Route: class private field. Node prints assignments-private-cache-once:ok.
const log: string[] = [];
class Store {
  #cache: Map<string, number> | undefined;
  private create(): Map<string, number> { log.push("new"); return new Map([["a", 1]]); }
  get(): Map<string, number> {
    const saved = this.#cache; let result: Map<string, number>;
if (saved === null || saved === undefined) { const next = this.create(); this.#cache = next; result = next; } else result = saved;
    return result;
  }
}
const store = new Store();
const first = store.get(), second = store.get();
assert.sameValue(first === second, true);
assert.sameValue(first.get("a"), 1);
assert.compareArray(log, ["new"]);
console.log("assignments-private-cache-once:ok");
