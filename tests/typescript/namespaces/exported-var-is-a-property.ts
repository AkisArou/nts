/*---
description: Each exported member is an enumerable property of the namespace object, in declaration order.
features: [ts-namespace]
---*/
namespace Bag {
  export const one = 1;
  const hidden = 2;
  export function two(): number {
    return hidden;
  }
  export class Three {}
}
assert.sameValue(Object.keys(Bag).join(","), "one,two,Three");
assert.sameValue(typeof Bag.Three, "function");
