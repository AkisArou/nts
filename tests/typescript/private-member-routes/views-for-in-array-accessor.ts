/*---
description: An interface array enumerates public fields without visiting a private getter or losing its brand.
features: [ts-private-member-routes, ts-private-member-route-views, ts-private-fields, ts-class, ts-class-fields, ts-accessors, ts-interfaces, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-errors, ts-narrowing]
---*/
// ForVault instances travel through VisibleItem array elements; node lists only public fields, leaves the private-get log empty, then reads the original private value.
interface VisibleItem { label: string; value: unknown; }
const getterLog: string[] = [];
class ForVault implements VisibleItem {
  label: string = "visible"; value: unknown; #value: unknown;
  constructor(value: unknown) { this.value = value; this.#value = value; }
  get #hidden(): unknown { getterLog.push("get"); return this.#value; }
  static owns(value: object): boolean { return #hidden in value; }
  static read(value: object): unknown { if (!(#hidden in value)) throw new TypeError(); return value.#hidden; }
}
for (const value of [undefined, -0, "", { id: 1 }]) {
  const first = new ForVault(value), second = new ForVault(value);
  const rows: VisibleItem[] = [second, first, second];
  for (const view of rows) {
    getterLog.length = 0; const keys: string[] = [];
    for (const key in view) keys.push(key);
    assert.compareArray(keys, ["label", "value"]); assert.compareArray(getterLog, []);
    assert.sameValue(view.value, value); assert.sameValue(ForVault.owns(view), true);
    assert.sameValue(ForVault.read(view), value); assert.compareArray(getterLog, ["get"]);
    const plain: VisibleItem = { label: view.label, value: view.value };
    assert.sameValue(ForVault.owns(plain), false); assert.throws(TypeError, () => ForVault.read(plain));
    assert.compareArray(getterLog, ["get"]);
  }
}
