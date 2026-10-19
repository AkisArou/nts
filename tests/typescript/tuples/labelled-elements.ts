/*---
description: Tuple labels are names for documentation only; the elements are read by index.
features: [ts-tuples, ts-tuple-labels]
---*/
type Rgb = [red: number, green: number, blue: number];
function hex([red, green, blue]: Rgb): string {
  return [red, green, blue].map((c) => c.toString(16).padStart(2, "0")).join("");
}
const teal: Rgb = [0, 128, 128];
assert.sameValue(hex(teal), "008080");
assert.sameValue(teal[1], 128);
assert.sameValue(Object.keys(teal).join(","), "0,1,2");
