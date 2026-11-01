/*---
description: A captured mutable array writer changes the values and length seen through a typed field in the middle of a cached scan.
features: [ts-length-route-shared, ts-arrays, ts-numbers, ts-iteration, ts-null-undefined, ts-unions, ts-interfaces, ts-objects, ts-function-types, ts-arrow-functions, ts-closures]
---*/
// A declared writer closure captures the array shared by a typed field; node exposes its shrink or growth immediately through that field.
type SharedLengthTrace = (string | number | undefined)[];
interface SharedLengthBox { values: number[]; }
const expectedLogs: SharedLengthTrace[] = [["before", 0, undefined, 0, "change", 0, 0, "after", 0, undefined, 0], ["before", 0, undefined, 0, "change", 1, 0, "after", 0, undefined, 0], ["before", 0, undefined, 0, "change", 2, 0, "after", 0, undefined, 0], ["before", 0, 10, 1, "change", 0, 1, "after", 0, 10, 1, "before", 1, undefined, 1, "after", 1, undefined, 1, "final", 0, 10, 1], ["before", 0, 10, 1, "change", 1, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "after", 1, undefined, 0], ["before", 0, 10, 1, "change", 2, 2, "after", 0, 10, 2, "before", 1, 100, 2, "after", 1, 100, 2, "final", 0, 10, 2, "final", 1, 100, 2], ["before", 0, 10, 3, "change", 0, 3, "after", 0, 10, 3, "before", 1, 11, 3, "after", 1, 11, 3, "before", 2, 12, 3, "after", 2, 12, 3, "before", 3, undefined, 3, "after", 3, undefined, 3, "final", 0, 10, 3, "final", 1, 11, 3, "final", 2, 12, 3], ["before", 0, 10, 3, "change", 1, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "after", 2, undefined, 0, "before", 3, undefined, 0, "after", 3, undefined, 0], ["before", 0, 10, 3, "change", 2, 6, "after", 0, 10, 6, "before", 1, 11, 6, "after", 1, 11, 6, "before", 2, 12, 6, "after", 2, 12, 6, "before", 3, 100, 6, "after", 3, 100, 6, "final", 0, 10, 6, "final", 1, 11, 6, "final", 2, 12, 6, "final", 3, 100, 6, "final", 4, 101, 6, "final", 5, 102, 6], ["before", 0, 10, 4, "change", 0, 4, "after", 0, 10, 4, "before", 1, 11, 4, "after", 1, 11, 4, "before", 2, 12, 4, "after", 2, 12, 4, "before", 3, 13, 4, "after", 3, 13, 4, "before", 4, undefined, 4, "after", 4, undefined, 4, "final", 0, 10, 4, "final", 1, 11, 4, "final", 2, 12, 4, "final", 3, 13, 4], ["before", 0, 10, 4, "change", 1, 0, "after", 0, undefined, 0, "before", 1, undefined, 0, "after", 1, undefined, 0, "before", 2, undefined, 0, "after", 2, undefined, 0, "before", 3, undefined, 0, "after", 3, undefined, 0, "before", 4, undefined, 0, "after", 4, undefined, 0], ["before", 0, 10, 4, "change", 2, 8, "after", 0, 10, 8, "before", 1, 11, 8, "after", 1, 11, 8, "before", 2, 12, 8, "after", 2, 12, 8, "before", 3, 13, 8, "after", 3, 13, 8, "before", 4, 100, 8, "after", 4, 100, 8, "final", 0, 10, 8, "final", 1, 11, 8, "final", 2, 12, 8, "final", 3, 13, 8, "final", 4, 100, 8, "final", 5, 101, 8, "final", 6, 102, 8, "final", 7, 103, 8]];
const expectedContents: (number | undefined)[][] = [[], [], [], [10], [], [10, 100], [10, 11, 12], [], [10, 11, 12, 100, 101, 102], [10, 11, 12, 13], [], [10, 11, 12, 13, 100, 101, 102, 103]];
for (const shape of [0, 1, 2, 3]) for (const mode of [0, 1, 2]) {
  const size = shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 3 : 4;
  const row = shape * 3 + mode; const log: SharedLengthTrace = [];
  const source: number[] = [];
  for (let index = 0; index < size; index++) source.push(10 + index);
  const owner: SharedLengthBox = { values: source };
  const write: () => void = () => {
    if (mode === 1) source.length = 0;
    if (mode === 2) for (let extra = 0; extra < size; extra++) source.push(100 + extra);
  };
  const limit = owner.values.length;
  for (let index = 0; index <= limit; index++) {
    const before: number | undefined = owner.values[index]; log.push("before", index, before, owner.values.length);
    if (index === 0) {
      write();
      log.push("change", mode, owner.values.length);
    }
    const after: number | undefined = owner.values[index]; log.push("after", index, after, owner.values.length);
  }
  const contents: (number | undefined)[] = [];
  for (let index = 0; index < owner.values.length; index++) {
    const value = owner.values[index]; log.push("final", index, value, owner.values.length); contents.push(value);
  }
  assert.compareArray(log, expectedLogs[row]); assert.compareArray(contents, expectedContents[row]);
  assert.sameValue(owner.values.length, expectedContents[row].length);
}
