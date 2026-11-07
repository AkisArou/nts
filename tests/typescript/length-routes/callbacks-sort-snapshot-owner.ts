/*---
description: A typed sort comparator sees snapshot elements while mutations keep their original array owner and appended tails.
features: [ts-length-route-callbacks, ts-arrays, ts-iteration, ts-numbers, ts-null-undefined, ts-arrow-functions, ts-functions, ts-closures]
---*/
// A pure comparator pins the final order. Mutating the owner makes the sort
// order implementation-defined, so those arms pin snapshot arguments, owner
// identity and tail preservation without fixing V8's comparison sequence.
let scenario = 0;
for (const size of [0, 1, 3, 4]) {
  const expected: number[] = size === 0 ? [] : size === 1 ? [2] : size === 3 ? [2, 4, 6] : [2, 4, 6, 12];
  const sorted: number[] = size === 0 ? [] : size === 1 ? [2] : size === 3 ? [6, 2, 4] : [12, 6, 2, 4];
  const pure = sorted.sort((a: number, b: number): number => a - b);
  assert.sameValue(pure, sorted);
  assert.compareArray(pure, expected);
  for (const mode of [0, 1, 2]) {
    const original: number[] = size === 0 ? [] : size === 1 ? [2] : size === 3 ? [6, 2, 4] : [12, 6, 2, 4];
    const values: number[] = size === 0 ? [] : size === 1 ? [2] : size === 3 ? [6, 2, 4] : [12, 6, 2, 4];
    let mutated = false;
    const result = values.sort((a: number, b: number): number => {
      let sawA = false;
      let sawB = false;
      for (let index = 0; index < original.length; index++) {
        if (original[index] === a) sawA = true;
        if (original[index] === b) sawB = true;
      }
      assert.sameValue(sawA, true);
      assert.sameValue(sawB, true);
      if (!mutated) {
        if (mode === 0 && values.length > 1) values[values.length - 1] = 90;
        else if (mode === 1) values.length = 0;
        else if (mode === 2) for (let added = 0; added < size; added++) values.push(100 + added);
        mutated = true;
      }
      assert.sameValue(values.length, mode === 1 ? 0 : mode === 2 ? size * 2 : size);
      return a - b;
    });
    assert.sameValue(result, values);
    const appended = mode === 2 && mutated;
    assert.sameValue(values.length, appended ? size * 2 : size);
    if (appended) for (let index = 0; index < size; index++) assert.sameValue(values[size + index], 100 + index);
    scenario++;
  }
}
assert.sameValue(scenario, 12);
