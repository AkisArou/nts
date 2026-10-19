/*---
description: An explicit type argument chooses the instantiation where inference would choose a narrower one.
features: [ts-generics]
---*/
function collect<T>(...values: T[]): T[] {
  return values;
}
const mixed = collect<number | string>(1, "two", 3);
mixed.push("four");
assert.sameValue(mixed.length, 4);
assert.sameValue(mixed.join("-"), "1-two-3-four");
const wide = collect<number>();
wide.push(2.5);
assert.sameValue(wide[0], 2.5);
