/*---
description: A non-null Map lookup retains an absent value through an interface field beside exact numeric witnesses. The control uses honest types.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-interfaces, ts-map-set, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-errors, ts-unions]
---*/
// A Map.get non-null claim crosses an interface field; node returns undefined for missing keys and retains -0, NaN and finite numbers. The control states the possible value honestly.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
interface NumberCatalog { entries: Map<string, number>; }
for (const input of [-0, 0, NaN, 7.25]) {
  const catalog: NumberCatalog = { entries: new Map([["present", input]]) };
  for (const key of ["missing", "present", "missing-again"]) {
    const value: number | undefined = catalog.entries.get(key);
    const expected: number | undefined = key === "present" ? input : undefined;
    same(value, expected);
    if (expected === undefined) assert.throws(TypeError, () => Number.prototype.valueOf.call(value));
    else same(Number.prototype.valueOf.call(value), expected);
  }
}
