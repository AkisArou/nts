/*---
description: An interface return from object spread keeps public references but carries neither private field nor private method brand.
features: [ts-private-member-routes, ts-private-member-route-views, ts-private-fields, ts-class, ts-class-fields, ts-interfaces, ts-functions, ts-this-parameter, ts-arrays, ts-iteration, ts-objects, ts-spread, ts-unknown, ts-errors]
---*/
// SpreadVault objects cross a VisibleSpread return; node preserves shallow public identity, excludes private state and methods, and rejects the copied receiver.
interface VisibleSpread { label: string; payload: object; }
function copyPublic(value: VisibleSpread): VisibleSpread { return { ...value }; }
class SpreadVault implements VisibleSpread {
  label: string = "visible"; payload: object; #secret: unknown;
  constructor(payload: object, secret: unknown) { this.payload = payload; this.#secret = secret; }
  #read(): unknown { return this.#secret; }
  read(): unknown { return this.#read(); }
  static owns(value: object): boolean { return #secret in value; }
  static callable(value: object): boolean { return #read in value; }
}
for (const secret of [undefined, -0, Symbol("secret"), { id: 1 }]) {
  const payload = { id: 1 }, first = new SpreadVault(payload, secret), second = new SpreadVault(payload, secret);
  const sources: SpreadVault[] = [second, first, first];
  for (const source of sources) {
    const copy = copyPublic(source), read: (this: object) => unknown = source.read;
    assert.notSameValue(copy, source); assert.compareArray(Reflect.ownKeys(copy), ["label", "payload"]);
    assert.sameValue(copy.label, "visible"); assert.sameValue(copy.payload, payload);
    assert.sameValue(SpreadVault.owns(source), true); assert.sameValue(SpreadVault.callable(source), true);
    assert.sameValue(SpreadVault.owns(copy), false); assert.sameValue(SpreadVault.callable(copy), false);
    assert.sameValue(read.call(source), secret); assert.throws(TypeError, () => read.call(copy));
    assert.sameValue("read" in copy, false); assert.sameValue(source.read(), secret);
  }
}
