/*---
description: instanceof follows the prototype chain through every level of a hierarchy.
features: [ts-class, ts-inheritance, ts-instanceof]
---*/
class Animal {}
class Bird extends Animal {}
class Penguin extends Bird {}
class Stone {}
const penguin = new Penguin();
assert.sameValue(penguin instanceof Penguin, true);
assert.sameValue(penguin instanceof Bird, true);
assert.sameValue(penguin instanceof Animal, true);
assert.sameValue(new Bird() instanceof Penguin, false);
assert.sameValue((new Stone() as object) instanceof Animal, false);
