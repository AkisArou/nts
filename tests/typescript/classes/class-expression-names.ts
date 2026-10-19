/*---
description: A named class expression has its own name; an anonymous one takes the name of its binding.
features: [ts-class, ts-class-expression]
---*/
const Named = class Inner {
  who(): string {
    return Inner.name;
  }
};
const Anonymous = class {};
class Declared {}
assert.sameValue(Named.name, "Inner");
assert.sameValue(new Named().who(), "Inner");
assert.sameValue(Anonymous.name, "Anonymous");
assert.sameValue(Declared.name, "Declared");
