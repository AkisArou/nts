/*---
description: A dotted namespace name nests one namespace in another.
features: [ts-namespace]
---*/
namespace Outer.Inner {
  export const depth = 2;
}
assert.sameValue(Outer.Inner.depth, 2);
