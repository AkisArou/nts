/*---
description: A typed tuple preserves the exact public string and symbol key order without exposing a private field.
features: [ts-private-member-routes, ts-private-member-route-views, ts-private-fields, ts-class, ts-class-fields, ts-inheritance, ts-interfaces, ts-tuples, ts-arrays, ts-iteration, ts-objects, ts-symbols, ts-unknown, ts-errors, ts-narrowing]
---*/
// ReflectVault objects travel in KeyView tuples; node returns numeric, string and public-symbol keys in order, with no private key and no brand on a lookalike.
const publicKey = Symbol("visible");
interface KeyView { "2": string; label: string; [publicKey]: unknown; }
class ReflectVault implements KeyView {
  "2": string = "two"; #secret: unknown; label: string = "visible"; [publicKey]: unknown;
  constructor(value: unknown) { this.#secret = value; this[publicKey] = value; }
  static owns(value: object): boolean { return #secret in value; }
  static read(value: object): unknown { if (!(#secret in value)) throw new TypeError(); return value.#secret; }
}
class ReflectChild extends ReflectVault {}
for (const value of [undefined, NaN, "", { id: 1 }]) {
  const owner = new ReflectVault(value), child = new ReflectChild(value);
  const plain: KeyView = { "2": "two", label: "visible", [publicKey]: value };
  const rows: [KeyView, boolean][] = [[owner, true], [plain, false], [child, true], [owner, true]];
  for (const [view, branded] of rows) {
    assert.compareArray(Reflect.ownKeys(view), ["2", "label", publicKey]);
    assert.sameValue(view[publicKey], value); assert.sameValue(view["2"], "two");
    assert.sameValue(ReflectVault.owns(view), branded);
    if (branded) assert.sameValue(ReflectVault.read(view), value);
    else assert.throws(TypeError, () => ReflectVault.read(view));
  }
}
