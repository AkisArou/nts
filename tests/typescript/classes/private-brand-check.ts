/*---
description: `#field in value` asks whether a value was constructed by the class, without reading the field.
features: [ts-class, ts-private-fields, ts-narrowing]
---*/
class Branded {
  #brand = true;
  static is(value: object): value is Branded {
    return #brand in value;
  }
}
class Lookalike {
  brand = true;
}
assert.sameValue(Branded.is(new Branded()), true);
assert.sameValue(Branded.is(new Lookalike()), false);
assert.sameValue(Branded.is({}), false);
