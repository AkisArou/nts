/*---
description: A tuple spread into a call supplies each parameter in order.
features: [ts-tuples, ts-spread]
---*/
function describe(label: string, count: number, urgent: boolean): string {
  return `${label}:${count}${urgent ? "!" : ""}`;
}
const args: [string, number, boolean] = ["task", 3, true];
assert.sameValue(describe(...args), "task:3!");
const tail: [number, boolean] = [0, false];
assert.sameValue(describe("x", ...tail), "x:0");
