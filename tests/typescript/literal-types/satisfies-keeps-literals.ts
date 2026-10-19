/*---
description: `satisfies` checks a value against a wider type while the value keeps its own, narrower one.
features: [ts-literal-types, ts-satisfies, ts-record]
---*/
const palette = {
  red: [255, 0, 0],
  green: "#00ff00",
} satisfies Record<string, string | number[]>;
assert.sameValue(palette.red.length, 3);
assert.sameValue(palette.green.toUpperCase(), "#00FF00");
assert.sameValue(Object.keys(palette).join(","), "red,green");
