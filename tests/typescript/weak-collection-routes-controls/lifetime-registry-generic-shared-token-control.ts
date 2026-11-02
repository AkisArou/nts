/*---
description: Control for lifetime-registry-generic-shared-token using a Set-backed token model and the same generic parameters.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-generics, ts-generic-constraints, ts-functions, ts-objects, ts-arrays, ts-tuples, ts-class, ts-class-fields, ts-iteration, ts-unknown, ts-map-set, ts-errors]
---*/
// A Set-backed registry model receives the same generic token; node deletes its shared membership once, preserves another token, and permits reuse.
class TokenRegistry {
  tokens: Set<object> = new Set<object>();
  register(target: object, held: unknown, token?: object): void {
    if (target === held) throw new TypeError();
    if (token !== undefined) assert.sameValue(this.tokens.add(token), this.tokens);
  }
  unregister(token: object): boolean { return this.tokens.delete(token); }
}
function check<T extends object>(token: T, other: T): void {
  const registry: TokenRegistry = new TokenRegistry();
  const first = { value: 1 }, second = { value: 1 };
  assert.sameValue(registry.register(first, 0, token), undefined);
  assert.sameValue(registry.register(second, "held", token), undefined);
  assert.sameValue(registry.register(first, null, other), undefined);
  assert.sameValue(registry.unregister(token), true);
  assert.sameValue(registry.unregister(token), false);
  assert.sameValue(registry.unregister(other), true);
  assert.sameValue(registry.unregister(other), false);
  assert.sameValue(registry.register(second, false, token), undefined);
  assert.sameValue(registry.unregister(token), true);
  assert.sameValue(registry.unregister(token), false);
  assert.sameValue(first === second, false);
}
class Token { value: number; constructor(value: number) { this.value = value; } }
const rows: [object, object][] = [[{ value: 1 }, { value: 1 }], [[1], [1]], [() => 1, () => 1], [new Token(1), new Token(1)]];
for (const [token, other] of rows) check(token, other);
