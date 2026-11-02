/*---
description: A declared tuple preserves duplicate instance aliases and two independent private names on equal-shaped owners.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-tuples, ts-private-fields]
---*/
// PairOwner instances cross a typed tuple; node shares alias writes while keeping the peer and the other private slot unchanged.
class PairOwner {
  #left: unknown; #right: unknown;
  constructor(left: unknown, right: unknown) { this.#left = left; this.#right = right; }
  left(): unknown { return this.#left; } right(): unknown { return this.#right; }
  writeLeft(value: unknown): unknown { return this.#left = value; }
  writeRight(value: unknown): unknown { return this.#right = value; }
}
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const marker = { value }, next = { value }, first = new PairOwner(value, marker), second = new PairOwner(value, marker);
  const route: [PairOwner, PairOwner, PairOwner] = [first, second, first];
  const [left, peer, alias] = route;
  assert.sameValue(left, alias); assert.notSameValue(left, peer);
  for (const owner of route) { assert.sameValue(owner.left(), value); assert.sameValue(owner.right(), marker); }
  assert.sameValue(left.writeLeft(next), next); assert.sameValue(alias.left(), next); assert.sameValue(alias.right(), marker);
  assert.sameValue(peer.left(), value); assert.sameValue(peer.right(), marker);
  assert.sameValue(alias.writeRight(value), value); assert.sameValue(left.left(), next); assert.sameValue(left.right(), value);
  assert.sameValue(peer.left(), value); assert.sameValue(peer.right(), marker);
}
