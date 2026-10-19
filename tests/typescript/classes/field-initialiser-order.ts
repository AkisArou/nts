/*---
description: Field initialisers run in order, each seeing the ones before it.
features: [ts-class, ts-class-fields]
---*/
class Chain {
  a = 1;
  b = this.a + 1;
  c = this.b * 10;
}
const chain = new Chain();
assert.sameValue(chain.b, 2);
assert.sameValue(chain.c, 20);
