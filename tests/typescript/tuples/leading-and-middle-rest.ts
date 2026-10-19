/*---
description: A rest element may lead a tuple or sit between fixed elements.
features: [ts-tuples, ts-tuple-rest]
---*/
type EndsWithFlag = [...values: number[], flag: boolean];
type Framed = [open: string, ...body: number[], close: string];
function lastFlag(t: EndsWithFlag): boolean {
  return t[t.length - 1] as boolean;
}
function frame(t: Framed): string {
  return `${t[0]}${t.slice(1, -1).join(",")}${t[t.length - 1]}`;
}
assert.sameValue(lastFlag([1, 2, true]), true);
assert.sameValue(lastFlag([false]), false);
assert.sameValue(frame(["[", 1, 2, 3, "]"]), "[1,2,3]");
assert.sameValue(frame(["(", ")"]), "()");
