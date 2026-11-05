/*---
description: "FlatMap removes only the returned outer array and retains each nested result by identity through readonly source arrays with a declared callback. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-arrow-functions, ts-numbers, ts-unknown]
---*/

function localFlatMap<T, U>(items: readonly T[], callback: (value: T, index: number, array: readonly T[]) => readonly U[]): U[] {
  const result: U[] = [];
  for (let i = 0; i < items.length; i++) {
    const part = callback(items[i], i, items);
    for (let j = 0; j < part.length; j++) result[result.length] = part[j];
  }
  return result;
}
// FlatMap removes only the returned outer array and retains each nested result by identity; route: readonly source arrays with a declared callback.
// Node prints copies-flatmap-readonly-nested-results:ok.
const inputs: readonly (readonly number[])[] = [[], [2], [3, 1, 4]];
for (const input of inputs) {
  const before: number[] = [], made: number[][] = [];
  for (const value of input) before[before.length] = value;
  const callback: (value: number) => readonly number[][] = (value: number) => {
    const inner: number[] = [value, value + 10];
    made[made.length] = inner;
    return [inner];
  };
  const result = localFlatMap(input, callback);
  const original: readonly unknown[] = input;
  assert.sameValue(result === original, false);
  assert.sameValue(result.length, before.length);
  for (let i = 0; i < result.length; i++) {
    assert.compareArray(result[i], [before[i], before[i] + 10]);
    assert.sameValue(result[i] === made[i], true);
  }
  assert.compareArray(input, before);
}
console.log("copies-flatmap-readonly-nested-results:ok");
