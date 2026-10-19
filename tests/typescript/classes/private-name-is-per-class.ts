/*---
description: A `#private` field read from an object of another class throws TypeError.
features: [ts-class, ts-private-fields]
---*/
class Left {
  #value = 1;
  static read(other: Left): number {
    return other.#value;
  }
}
class Right {
  #value = 2;
}
assert.sameValue(Left.read(new Left()), 1);
const impostor = new Right() as unknown as Left;
assert.throws(TypeError, () => {
  Left.read(impostor);
});
