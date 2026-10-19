/*---
description: The typeof operator names the run-time type of a value of each TypeScript type.
features: [ts-typeof-operator]
---*/
class Box {}
const values: unknown[] = [1, "s", true, 1n, Symbol("x"), undefined, null, {}, [], () => 0, Box, new Box()];
assert.sameValue(
  values.map((v) => typeof v).join(","),
  "number,string,boolean,bigint,symbol,undefined,object,object,object,function,function,object",
);
