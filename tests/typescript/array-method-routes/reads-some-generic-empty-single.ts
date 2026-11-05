/*---
description: "some is false on an empty array without invoking its callback and evaluates singleton falsy values normally."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-strings, ts-readonly, ts-arrow-functions]
---*/

// some is false on an empty array without invoking its callback and evaluates singleton falsy values normally. Route: a constrained helper at number and string type arguments. Node prints reads-some-generic-empty-single:ok.
function inspect<T extends number | string>(value: T, missing: T): void {
  const sources: readonly (readonly T[])[] = [[], [value], [missing]];
  const expected: readonly boolean[] = [false, true, false];
  for (let i = 0; i < sources.length; i++) {
    const items = sources[i], seen: T[] = [];
    const found = items.some(item => { seen[seen.length] = item; return item === value; });
    assert.sameValue(found, expected[i]); assert.compareArray(seen, items);
  }
}
inspect<number>(0, 1);
inspect<string>("", "missing");
console.log("reads-some-generic-empty-single:ok");
