/*---
description: An `export import` alias inside a namespace becomes one of its properties.
features: [ts-namespace, ts-import-alias]
---*/
namespace Lib.Deep {
  export const depth = 3;
}
namespace App {
  export import D = Lib.Deep;
  export const next = D.depth + 1;
}
assert.sameValue(App.D.depth, 3);
assert.sameValue(App.next, 4);
assert.sameValue(App.D === Lib.Deep, true);
