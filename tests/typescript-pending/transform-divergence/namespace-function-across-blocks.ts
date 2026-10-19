/*---
description: In a merged namespace, a function exported by an earlier block is called unqualified from a later block.
features: [ts-namespace, ts-declaration-merging, ts-functions]
---*/
namespace Words {
  export function shout(s: string): string {
    return s.toUpperCase();
  }
}
namespace Words {
  export function greet(who: string): string {
    return shout(`hi ${who}`);
  }
}
assert.sameValue(Words.greet("kim"), "HI KIM");
