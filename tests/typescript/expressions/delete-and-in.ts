/*---
description: delete reports true and removes an own optional property; `in` sees own and inherited keys.
features: [ts-expressions, ts-optional-properties]
---*/
class Base {
  inherited(): number {
    return 1;
  }
}
const object: Base & { own?: number } = Object.assign(new Base(), { own: 2 });
assert.sameValue("own" in object, true);
assert.sameValue("inherited" in object, true);
assert.sameValue(delete object.own, true);
assert.sameValue("own" in object, false);
assert.sameValue("inherited" in object, true);
