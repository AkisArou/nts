/*---
description: Symbols are Map keys by identity, so two symbols with one description are two keys.
features: [ts-symbols, ts-map-set]
---*/
const first = Symbol("k");
const second = Symbol("k");
const registry = new Map<symbol, number>([[first, 1]]);
registry.set(second, 2);
assert.sameValue(registry.size, 2);
assert.sameValue(registry.get(first), 1);
assert.sameValue(registry.get(Symbol("k")), undefined);
