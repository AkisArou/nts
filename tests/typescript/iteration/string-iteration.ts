/*---
description: Iterating a string yields code points, while indexing and length count UTF-16 units.
features: [ts-iteration, ts-strings]
---*/
const text = "a😀b";
const points: string[] = [...text];
assert.sameValue(text.length, 4);
assert.sameValue(points.length, 3);
assert.sameValue(points[1], "😀");
assert.sameValue(text[1] === "😀", false);
assert.sameValue(text.codePointAt(1), 0x1f600);
