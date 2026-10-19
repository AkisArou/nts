/*---
description: Inside a namespace, an exported name shadows a global of the same name.
features: [ts-namespace]
---*/
namespace Local {
  export const Math = { max: (a: number, b: number): number => a + b };
  export function pick(): number {
    return Math.max(2, 3);
  }
}
assert.sameValue(Local.pick(), 5);
assert.sameValue(Math.max(2, 3), 3);
