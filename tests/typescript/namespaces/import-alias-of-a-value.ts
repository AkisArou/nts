/*---
description: An import alias may name a value a namespace exports, read when the alias is declared.
features: [ts-namespace, ts-import-alias]
---*/
namespace Config {
  export const limit = 8;
  export function twice(n: number): number {
    return n * 2;
  }
}
import limit = Config.limit;
import twice = Config.twice;
assert.sameValue(twice(limit), 16);
