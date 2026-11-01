/*---
description: A class parameter drops its ECMAScript private slot and prototype method.
features: [ts-structuredclone-route-classes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-private-fields, ts-interfaces, ts-numbers, ts-instanceof]
---*/
// A Vault parameter carries an own public value and a private slot; node copies only the public data into a plain object.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
interface VaultData { value: number; }
class Vault {
  #secret: number; value: number;
  constructor(n: number) { this.#secret = n; this.value = n; }
  reveal(): number { return this.#secret; }
  static hasSecret(value: object): boolean { return #secret in value; }
}
function copyVault(source: Vault): VaultData { return structuredClone(source); }
for (const n of [-0, NaN, 7]) {
  const source: Vault = new Vault(n), result = copyVault(source);
  fresh(result, source, Object.prototype, ["value"]); same(result.value, n); same(result instanceof Vault, false);
  same("reveal" in result, false); same(Vault.hasSecret(result), false); same(Vault.hasSecret(source), true); same(source.reveal(), n);
  result.value = 21; same(source.value, n); source.value = 32; same(result.value, 21); same(source.reveal(), n);
}
