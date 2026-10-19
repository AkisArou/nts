/*---
description: A mapped type with `as` renames keys; a function builds an object with exactly those renamed getters.
features: [ts-type-operators, ts-mapped-types, ts-template-literal-types]
---*/
type Getters<T> = { [K in keyof T & string as `get${Capitalize<K>}`]: () => T[K] };
function gettersOf<T extends object>(object: T): Getters<T> {
  const out: Record<string, () => unknown> = {};
  for (const key of Object.keys(object)) {
    out[`get${key.charAt(0).toUpperCase()}${key.slice(1)}`] = () => object[key as keyof T];
  }
  return out as Getters<T>;
}
const getters = gettersOf({ count: 2, label: "x" });
assert.sameValue(getters.getCount() + 1, 3);
assert.sameValue(getters.getLabel(), "x");
assert.sameValue(Object.keys(getters).join(","), "getCount,getLabel");
