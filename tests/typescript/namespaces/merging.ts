/*---
description: Two blocks of one namespace merge into one object.
features: [ts-namespace, ts-declaration-merging]
---*/
namespace Merged {
  export const a = 1;
}
namespace Merged {
  // Qualified: an unqualified `a` here is TypeScript's to resolve, which node's
  // type stripping (this suite's oracle) does not do.
  export const b = Merged.a + 1;
}
assert.sameValue(Merged.a, 1);
assert.sameValue(Merged.b, 2);
