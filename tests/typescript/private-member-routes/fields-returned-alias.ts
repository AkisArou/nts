/*---
description: A declared class return preserves a selected instance and lets later writes remain visible through that returned alias.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-private-fields]
---*/
// Vault instances return from choose; node preserves selected identity, shared reference payloads and the untouched equal-shaped peer.
class Vault {
  label: string = "same"; #value: unknown;
  constructor(value: unknown) { this.#value = value; }
  read(): unknown { return this.#value; }
  write(value: unknown): unknown { return this.#value = value; }
  static owns(value: object): boolean { return #value in value; }
}
function choose(first: Vault, second: Vault, useFirst: boolean): Vault { return useFirst ? first : second; }
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const first: Vault = new Vault(value), second: Vault = new Vault(value);
  for (const useFirst of [false, true, false]) {
    const selected: Vault = choose(first, second, useFirst), expected = useFirst ? first : second, peer = useFirst ? second : first;
    const next = { value };
    assert.sameValue(selected, expected); assert.sameValue(Vault.owns(selected), true);
    assert.sameValue(selected.read(), value); assert.sameValue(selected.write(next), next);
    assert.sameValue(expected.read(), next); assert.sameValue(peer.read(), value);
    assert.sameValue(expected.write(value), value); assert.sameValue(selected.read(), value);
  }
}
