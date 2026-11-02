/*---
description: Map values viewed through an interface serialize only public data and parsed copies have no private brand (Map control).
features: [ts-private-member-routes, ts-private-member-route-views, ts-map-set, ts-class, ts-class-fields, ts-interfaces, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-bigint, ts-errors, ts-narrowing]
---*/
// JsonVault instances cross Map<string, JsonView> lookups; node ignores a private bigint or cyclic object, emits exact public JSON and leaves parsed objects unbranded.
interface JsonView { label: string; value: number; }
const cyclic: { self?: object } = {}; cyclic.self = cyclic;
const jsonSecrets = new Map<object, unknown>();
class JsonVault implements JsonView {
  label: string = "visible"; value: number = 7;
  constructor(secret: unknown) { jsonSecrets.set(this, secret); }
  static owns(value: object): boolean { return jsonSecrets.has(value); }
  static read(value: object): unknown { if (!jsonSecrets.has(value)) throw new TypeError(); return jsonSecrets.get(value); }
}
for (const secret of [1n, cyclic, undefined]) {
  const second = new JsonVault(secret), first = new JsonVault(secret);
  const table = new Map<string, JsonView>([["first", first], ["second", second], ["alias", first]]);
  for (const key of ["second", "alias", "first"]) {
    const view = table.get(key); if (view === undefined) throw new Error("missing view");
    const text = JSON.stringify(view), parsed: unknown = JSON.parse(text);
    assert.sameValue(view, key === "second" ? second : first);
    assert.sameValue(text, '{"label":"visible","value":7}');
    assert.sameValue(JsonVault.owns(view), true); assert.sameValue(JsonVault.read(view), secret);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    assert.compareArray(Reflect.ownKeys(parsed), ["label", "value"]);
    assert.sameValue(JsonVault.owns(parsed), false); assert.throws(TypeError, () => JsonVault.read(parsed));
    assert.sameValue(JsonVault.read(view), secret);
  }
}
