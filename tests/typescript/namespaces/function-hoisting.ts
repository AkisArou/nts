/*---
description: An exported function may be called inside its namespace before the line that declares it.
features: [ts-namespace]
---*/
namespace Early {
  export const answer = compute();
  export function compute(): number {
    return 42;
  }
}
assert.sameValue(Early.answer, 42);
assert.sameValue(Early.compute(), 42);
