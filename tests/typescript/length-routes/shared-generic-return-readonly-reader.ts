/*---
description: A generic readonly return shares its mutable input across complete passes before and after a length-changing write.
features: [ts-length-route-shared, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions, ts-functions, ts-generics, ts-readonly]
---*/
// A generic Array<T> helper returns a readonly view; node sees the original array change between two full saved-bound passes.
type SharedLengthTrace = (string | number | undefined)[];
function shareReadonlyArray<T>(values: Array<T>): readonly T[] { return values; }
const expectedLogs: SharedLengthTrace[] = [["pass", 0, 0, undefined, 0, "change", 0, 0, "pass", 1, 0, undefined, 0], ["pass", 0, 0, undefined, 0, "change", 1, 0, "pass", 1, 0, undefined, 0], ["pass", 0, 0, undefined, 0, "change", 2, 0, "pass", 1, 0, undefined, 0], ["pass", 0, 0, 10, 1, "pass", 0, 1, undefined, 1, "change", 0, 1, "pass", 1, 0, 10, 1, "pass", 1, 1, undefined, 1, "final", 0, 10, 1], ["pass", 0, 0, 10, 1, "pass", 0, 1, undefined, 1, "change", 1, 0, "pass", 1, 0, undefined, 0, "pass", 1, 1, undefined, 0], ["pass", 0, 0, 10, 1, "pass", 0, 1, undefined, 1, "change", 2, 2, "pass", 1, 0, 10, 2, "pass", 1, 1, 100, 2, "final", 0, 10, 2, "final", 1, 100, 2], ["pass", 0, 0, 10, 3, "pass", 0, 1, 11, 3, "pass", 0, 2, 12, 3, "pass", 0, 3, undefined, 3, "change", 0, 3, "pass", 1, 0, 10, 3, "pass", 1, 1, 11, 3, "pass", 1, 2, 12, 3, "pass", 1, 3, undefined, 3, "final", 0, 10, 3, "final", 1, 11, 3, "final", 2, 12, 3], ["pass", 0, 0, 10, 3, "pass", 0, 1, 11, 3, "pass", 0, 2, 12, 3, "pass", 0, 3, undefined, 3, "change", 1, 0, "pass", 1, 0, undefined, 0, "pass", 1, 1, undefined, 0, "pass", 1, 2, undefined, 0, "pass", 1, 3, undefined, 0], ["pass", 0, 0, 10, 3, "pass", 0, 1, 11, 3, "pass", 0, 2, 12, 3, "pass", 0, 3, undefined, 3, "change", 2, 6, "pass", 1, 0, 10, 6, "pass", 1, 1, 11, 6, "pass", 1, 2, 12, 6, "pass", 1, 3, 100, 6, "final", 0, 10, 6, "final", 1, 11, 6, "final", 2, 12, 6, "final", 3, 100, 6, "final", 4, 101, 6, "final", 5, 102, 6], ["pass", 0, 0, 10, 4, "pass", 0, 1, 11, 4, "pass", 0, 2, 12, 4, "pass", 0, 3, 13, 4, "pass", 0, 4, undefined, 4, "change", 0, 4, "pass", 1, 0, 10, 4, "pass", 1, 1, 11, 4, "pass", 1, 2, 12, 4, "pass", 1, 3, 13, 4, "pass", 1, 4, undefined, 4, "final", 0, 10, 4, "final", 1, 11, 4, "final", 2, 12, 4, "final", 3, 13, 4], ["pass", 0, 0, 10, 4, "pass", 0, 1, 11, 4, "pass", 0, 2, 12, 4, "pass", 0, 3, 13, 4, "pass", 0, 4, undefined, 4, "change", 1, 0, "pass", 1, 0, undefined, 0, "pass", 1, 1, undefined, 0, "pass", 1, 2, undefined, 0, "pass", 1, 3, undefined, 0, "pass", 1, 4, undefined, 0], ["pass", 0, 0, 10, 4, "pass", 0, 1, 11, 4, "pass", 0, 2, 12, 4, "pass", 0, 3, 13, 4, "pass", 0, 4, undefined, 4, "change", 2, 8, "pass", 1, 0, 10, 8, "pass", 1, 1, 11, 8, "pass", 1, 2, 12, 8, "pass", 1, 3, 13, 8, "pass", 1, 4, 100, 8, "final", 0, 10, 8, "final", 1, 11, 8, "final", 2, 12, 8, "final", 3, 13, 8, "final", 4, 100, 8, "final", 5, 101, 8, "final", 6, 102, 8, "final", 7, 103, 8]];
const expectedContents: (number | undefined)[][] = [[], [], [], [10], [], [10, 100], [10, 11, 12], [], [10, 11, 12, 100, 101, 102], [10, 11, 12, 13], [], [10, 11, 12, 13, 100, 101, 102, 103]];
for (const shape of [0, 1, 2, 3]) for (const mode of [0, 1, 2]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const row = shape * 3 + mode; const log: SharedLengthTrace = [];
  const source: number[] = [];
  for (let index = 0; index < size; index++) source.push(10 + index);
  const reader: readonly number[] = shareReadonlyArray(source);
  const limit = reader.length;
  for (const phase of [0, 1]) {
    if (phase === 1) {
      if (mode === 1) source.length = 0;
      if (mode === 2) for (let extra = 0; extra < size; extra++) source.push(100 + extra);
      log.push("change", mode, reader.length);
    }
    for (let index = 0; index <= limit; index++) {
      const value: number | undefined = reader[index]; log.push("pass", phase, index, value, reader.length);
    }
  }
  const contents: (number | undefined)[] = [];
  for (let index = 0; index < reader.length; index++) {
    const value = reader[index]; log.push("final", index, value, reader.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[row]); assert.compareArray(contents, expectedContents[row]);
  assert.sameValue(reader.length, expectedContents[row].length);
}
