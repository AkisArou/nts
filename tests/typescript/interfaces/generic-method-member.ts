/*---
description: An interface member that is itself generic is implemented once and called at several types.
features: [ts-interfaces, ts-generics]
---*/
interface Mapper {
  each<T, U>(items: T[], f: (item: T) => U): U[];
}
const mapper: Mapper = {
  each<T, U>(items: T[], f: (item: T) => U): U[] {
    const out: U[] = [];
    for (const item of items) out.push(f(item));
    return out;
  },
};
assert.compareArray(mapper.each([1, 2], (n) => n * 3), [3, 6]);
assert.compareArray(mapper.each(["a", "bc"], (s) => s.length), [1, 2]);
assert.compareArray(mapper.each([true], (b) => !b), [false]);
