/*---
description: A declared tuple preserves duplicate instance aliases and two independent private names on equal-shaped owners. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-tuples, ts-map-set]
---*/
// PairOwner instances cross a typed tuple; node shares alias writes while keeping the peer and the other private slot unchanged. The control stores each private name in its own checked Map.
const leftValues = new Map<object, unknown>(), rightValues = new Map<object, unknown>();
class PairOwner {
  constructor(left: unknown, right: unknown) { leftValues.set(this, left); rightValues.set(this, right); }
  left(): unknown { if (!leftValues.has(this)) throw new TypeError(); return leftValues.get(this); }
  right(): unknown { if (!rightValues.has(this)) throw new TypeError(); return rightValues.get(this); }
  writeLeft(value: unknown): unknown { if (!leftValues.has(this)) throw new TypeError(); leftValues.set(this, value); return value; }
  writeRight(value: unknown): unknown { if (!rightValues.has(this)) throw new TypeError(); rightValues.set(this, value); return value; }
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
