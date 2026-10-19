/*---
description: A static `#private` field and method belong to the class itself.
features: [ts-class, ts-private-fields, ts-static]
---*/
class Ids {
  static #next = 1;
  static #advance(): number {
    return Ids.#next++;
  }
  static take(): number {
    return Ids.#advance();
  }
}
assert.sameValue(Ids.take(), 1);
assert.sameValue(Ids.take(), 2);
assert.sameValue(Object.keys(Ids).length, 0);
