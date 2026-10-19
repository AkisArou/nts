/*---
description: A namespace's later block adds to the object its first block made, not to a copy.
features: [ts-namespace, ts-declaration-merging]
---*/
namespace Grow {
  export const a = 1;
}
const early = Grow;
namespace Grow {
  export const b = 2;
}
assert.sameValue(early === Grow, true);
assert.sameValue(early.b, 2);
