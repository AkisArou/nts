/*---
description: An interface parameter exposes public string keys while a same-spelled private field keeps its separate brand (Map control).
features: [ts-private-member-routes, ts-private-member-route-views, ts-map-set, ts-class, ts-class-fields, ts-inheritance, ts-interfaces, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-errors, ts-narrowing]
---*/
// KeyVault instances cross PublicKeys parameters; node enumerates the literal public key and never the private slot, including subclass and equal-shaped objects.
interface PublicKeys { label: string; value: unknown; "#value": string; }
function keysOf(value: PublicKeys): string[] { return Object.keys(value); }
const keyValues = new Map<object, unknown>();
class KeyVault implements PublicKeys {
  label: string = "visible"; value: unknown; "#value": string = "public";
  constructor(value: unknown) { this.value = value; keyValues.set(this, value); }
  static owns(value: object): boolean { return keyValues.has(value); }
  static read(value: object): unknown { if (!keyValues.has(value)) throw new TypeError(); return keyValues.get(value); }
}
class KeyChild extends KeyVault {}
for (const value of [undefined, -0, "", { id: 1 }]) {
  const child = new KeyChild(value), owner = new KeyVault(value);
  const plain: PublicKeys = { label: "visible", value, "#value": "public" };
  const rows: [PublicKeys, boolean][] = [[child, true], [owner, true], [plain, false], [owner, true]];
  for (const [view, branded] of rows) {
    assert.compareArray(keysOf(view), ["label", "value", "#value"]);
    assert.sameValue(view.value, value); assert.sameValue(view["#value"], "public");
    assert.sameValue(KeyVault.owns(view), branded);
    if (branded) assert.sameValue(KeyVault.read(view), value);
    else assert.throws(TypeError, () => KeyVault.read(view));
  }
}
