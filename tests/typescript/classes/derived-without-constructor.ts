/*---
description: A subclass with no constructor passes all its arguments to the base constructor.
features: [ts-class, ts-inheritance]
---*/
class Pair {
  constructor(public left: string, public right: string) {}
}
class NamedPair extends Pair {
  joined(): string {
    return this.left + this.right;
  }
}
const pair = new NamedPair("a", "b");
assert.sameValue(pair.joined(), "ab");
assert.sameValue(NamedPair.length, 0);
