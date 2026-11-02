/*---
description: A replaced interface field clones public nested data while an uncloneable private payload stays on its original instance (Map control).
features: [ts-private-member-routes, ts-private-member-route-views, ts-map-set, ts-class, ts-class-fields, ts-interfaces, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-symbols, ts-functions, ts-errors, ts-narrowing]
---*/
// CloneVault objects cross CloneHolder.item; node clones only public data, preserves the original private symbol or function, and rejects each clone as a private receiver.
interface CloneView { label: string; data: { id: number }; }
class CloneHolder { item: CloneView; constructor(item: CloneView) { this.item = item; } }
const cloneSecrets = new Map<object, unknown>();
class CloneVault implements CloneView {
  label: string = "visible"; data: { id: number };
  constructor(data: { id: number }, secret: unknown) { this.data = data; cloneSecrets.set(this, secret); }
  static owns(value: object): boolean { return cloneSecrets.has(value); }
  static read(value: object): unknown { if (!cloneSecrets.has(value)) throw new TypeError(); return cloneSecrets.get(value); }
}
for (const secret of [Symbol("secret"), () => 7, undefined]) {
  const first = new CloneVault({ id: 1 }, secret), second = new CloneVault({ id: 2 }, secret);
  const holder = new CloneHolder(first), sources: CloneVault[] = [second, first, second];
  for (const source of sources) {
    holder.item = source; const copy = structuredClone(holder.item);
    assert.sameValue(holder.item, source); assert.notSameValue(copy, source); assert.notSameValue(copy.data, source.data);
    assert.compareArray(Reflect.ownKeys(copy), ["label", "data"]);
    assert.sameValue(copy.label, "visible"); assert.sameValue(copy.data.id, source.data.id);
    assert.sameValue(CloneVault.owns(holder.item), true); assert.sameValue(CloneVault.read(holder.item), secret);
    assert.sameValue(CloneVault.owns(copy), false); assert.throws(TypeError, () => CloneVault.read(copy));
    copy.data.id = 99; assert.sameValue(source.data.id, source === first ? 1 : 2);
    assert.sameValue(CloneVault.read(source), secret);
  }
}
