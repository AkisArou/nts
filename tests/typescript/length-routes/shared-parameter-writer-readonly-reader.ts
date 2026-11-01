/*---
description: A mutable parameter writer invalidates the saved traversal bound of a readonly alias without losing its exact post-call contents.
features: [ts-length-route-shared, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions, ts-functions, ts-readonly]
---*/
// A number[] parameter writes through the same allocation as a readonly reader; node retains the saved visits but reads current contents.
type SharedLengthTrace = (string | number | undefined)[];
function writeSharedParameter(values: number[], size: number, mode: number): void {
  if (mode === 1) values.length = 0;
  if (mode === 2) for (let extra = 0; extra < size; extra++) values.push(100 + extra);
}
const expectedLogs: SharedLengthTrace[] = [["before", 0, undefined, 0, "change", 0, 0, "after", 0, undefined, 0], ["before", 0, undefined, 0, "change", 1, 0, "after", 0, undefined, 0], ["before", 0, undefined, 0, "change", 2, 0, "after", 0, undefined, 0], ["before", 0, 10, 1, "change", 0, 1, "after", 0, 10, 1, "before", 1, undefined, 1, "after", 1, undefined, 1, "final", 0, 10, 1], ["before", 0, 10, 1, "change", 1, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "after", 1, undefined, 0], ["before", 0, 10, 1, "change", 2, 2, "after", 0, 10, 2, "before", 1, 100, 2, "after", 1, 100, 2, "final", 0, 10, 2, "final", 1, 100, 2], ["before", 0, 10, 3, "change", 0, 3, "after", 0, 10, 3, "before", 1, 11, 3, "after", 1, 11, 3, "before", 2, 12, 3, "after", 2, 12, 3, "before", 3, undefined, 3, "after", 3, undefined, 3, "final", 0, 10, 3, "final", 1, 11, 3, "final", 2, 12, 3], ["before", 0, 10, 3, "change", 1, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "after", 2, undefined, 0, "before", 3, undefined, 0, "after", 3, undefined, 0], ["before", 0, 10, 3, "change", 2, 6, "after", 0, 10, 6, "before", 1, 11, 6, "after", 1, 11, 6, "before", 2, 12, 6, "after", 2, 12, 6, "before", 3, 100, 6, "after", 3, 100, 6, "final", 0, 10, 6, "final", 1, 11, 6, "final", 2, 12, 6, "final", 3, 100, 6, "final", 4, 101, 6, "final", 5, 102, 6], ["before", 0, 10, 4, "change", 0, 4, "after", 0, 10, 4, "before", 1, 11, 4, "after", 1, 11, 4, "before", 2, 12, 4, "after", 2, 12, 4, "before", 3, 13, 4, "after", 3, 13, 4, "before", 4, undefined, 4, "after", 4, undefined, 4, "final", 0, 10, 4, "final", 1, 11, 4, "final", 2, 12, 4, "final", 3, 13, 4], ["before", 0, 10, 4, "change", 1, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "after", 2, undefined, 0, "before", 3, undefined, 0, "after", 3, undefined, 0, "before", 4, undefined, 0, "after", 4, undefined, 0], ["before", 0, 10, 4, "change", 2, 8, "after", 0, 10, 8, "before", 1, 11, 8, "after", 1, 11, 8, "before", 2, 12, 8, "after", 2, 12, 8, "before", 3, 13, 8, "after", 3, 13, 8, "before", 4, 100, 8, "after", 4, 100, 8, "final", 0, 10, 8, "final", 1, 11, 8, "final", 2, 12, 8, "final", 3, 13, 8, "final", 4, 100, 8, "final", 5, 101, 8, "final", 6, 102, 8, "final", 7, 103, 8]];
const expectedContents: (number | undefined)[][] = [[], [], [], [10], [], [10, 100], [10, 11, 12], [], [10, 11, 12, 100, 101, 102], [10, 11, 12, 13], [], [10, 11, 12, 13, 100, 101, 102, 103]];
for (const shape of [0, 1, 2, 3]) for (const mode of [0, 1, 2]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const row = shape * 3 + mode; const log: SharedLengthTrace = [];
  const source: number[] = [];
  for (let index = 0; index < size; index++) source.push(10 + index);
  const reader: readonly number[] = source;
  const limit = reader.length;
  for (let index = 0; index <= limit; index++) {
    const before: number | undefined = reader[index]; log.push("before", index, before, reader.length);
    if (index === 0) {
      writeSharedParameter(source, size, mode);
      log.push("change", mode, reader.length);
    }
    const after: number | undefined = reader[index]; log.push("after", index, after, reader.length);
  }
  const contents: (number | undefined)[] = [];
  for (let index = 0; index < reader.length; index++) {
    const value = reader[index]; log.push("final", index, value, reader.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[row]); assert.compareArray(contents, expectedContents[row]);
  assert.sameValue(reader.length, expectedContents[row].length);
}
