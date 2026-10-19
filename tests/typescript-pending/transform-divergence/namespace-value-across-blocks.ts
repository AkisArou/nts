/*---
description: In a merged namespace, an unqualified name exported by an earlier block resolves to that export.
features: [ts-namespace, ts-declaration-merging]
---*/
namespace Units {
  export const base = 10;
}
namespace Units {
  export const doubled = base * 2;
}
assert.sameValue(Units.doubled, 20);
