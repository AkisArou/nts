/*---
description: Control for lifetime-registry-tuple-target-token using a Set-backed token model with the same target and held-value tuples.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-tuples, ts-arrays, ts-objects, ts-functions, ts-class, ts-class-fields, ts-iteration, ts-unknown, ts-null-undefined, ts-bigint, ts-symbols, ts-map-set, ts-errors]
---*/
// A Set-backed registry model takes the same tuples; node accepts each target as its own token with distinct held data, then unregisters true and false.
class TokenRegistry {
  tokens: Set<object> = new Set<object>();
  register(target: object, held: unknown, token?: object): void {
    if (target === held) throw new TypeError();
    if (token !== undefined) assert.sameValue(this.tokens.add(token), this.tokens);
  }
  unregister(token: object): boolean { return this.tokens.delete(token); }
}
class Item { value: number; constructor(value: number) { this.value = value; } }
const shared = { value: 1 };
const rows: [object, unknown][] = [[shared, undefined], [{ value: 1 }, null], [shared, false], [[1], -0], [() => 1, 1n], [new Item(1), Symbol.for("held")], [{ value: 1 }, { value: 1 }], [[1], () => 2]];
function check(row: [object, unknown]): void {
  const [target, held] = row, registry: TokenRegistry = new TokenRegistry();
  assert.sameValue(registry.register(target, held, target), undefined);
  assert.sameValue(registry.unregister(target), true);
  assert.sameValue(registry.unregister(target), false);
  assert.sameValue(row[0], target);
  assert.sameValue(row[1], held);
}
for (const row of rows) check(row);
