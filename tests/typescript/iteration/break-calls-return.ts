/*---
description: Breaking out of for-of calls the iterator's return method; finishing normally does not.
features: [ts-iteration]
---*/
let closings = 0;
function tracked(items: string[]): Iterable<string> {
  return {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next: (): IteratorResult<string> => (i < items.length ? { value: items[i++], done: false } : { value: undefined, done: true }),
        return: (): IteratorResult<string> => {
          closings++;
          return { value: undefined, done: true };
        },
      };
    },
  };
}
for (const item of tracked(["a", "b", "c"])) if (item === "b") break;
for (const item of tracked(["x"])) assert.sameValue(item, "x");
assert.sameValue(closings, 1);
