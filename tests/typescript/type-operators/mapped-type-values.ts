/*---
description: A function typed with a mapped type returns an object with the same keys and transformed values.
features: [ts-type-operators, ts-mapped-types, ts-generics, ts-keyof]
---*/
function mapValues<T extends object, U>(object: T, f: (value: T[keyof T], key: keyof T) => U): { [K in keyof T]: U } {
  const out = {} as { [K in keyof T]: U };
  for (const key of Object.keys(object) as (keyof T)[]) out[key] = f(object[key], key);
  return out;
}
const sizes = { small: 1, medium: 5, large: 10 };
const labels = mapValues(sizes, (n, key) => `${String(key)}=${n * 2}`);
assert.sameValue(labels.medium, "medium=10");
assert.sameValue(Object.keys(labels).join(","), "small,medium,large");
