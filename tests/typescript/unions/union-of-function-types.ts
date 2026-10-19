/*---
description: A union of function types is narrowed by its arity before the call.
features: [ts-unions, ts-narrowing, ts-function-types]
---*/
type Handler = ((a: number) => number) | ((a: number, b: number) => number);
function call(handler: Handler): number {
  if (handler.length === 2) return (handler as (a: number, b: number) => number)(3, 4);
  return (handler as (a: number) => number)(3);
}
assert.sameValue(call((a: number) => a * 10), 30);
assert.sameValue(call((a: number, b: number) => a + b), 7);
