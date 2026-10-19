/*---
description: A namespace exported from inside another is a property of it, and sees the outer namespace's exports.
features: [ts-namespace]
---*/
namespace Outer {
  export const base = 10;
  export namespace Inner {
    export const value = base + 1;
  }
}
assert.sameValue(Outer.Inner.value, 11);
assert.sameValue(Object.keys(Outer).join(","), "base,Inner");
