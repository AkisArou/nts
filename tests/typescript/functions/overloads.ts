/*---
description: Overload signatures are erased; the single implementation handles every call shape.
features: [ts-functions, ts-overloads]
---*/
function pad(value: number, width: number): string;
function pad(value: string, width: number, fill: string): string;
function pad(value: number | string, width: number, fill = "0"): string {
  return String(value).padStart(width, fill);
}
assert.sameValue(pad(7, 3), "007");
assert.sameValue(pad("ab", 4, "."), "..ab");
assert.sameValue(pad.length, 2);
