/*---
description: A member name typed as keyof typeof the enum indexes the enum object to its value.
features: [ts-enum, ts-keyof, ts-typeof-type]
---*/
enum Color { Red = 1, Green = 2, Blue = 4 }
function byName(name: keyof typeof Color): Color {
  return Color[name];
}
assert.sameValue(byName("Green"), 2);
assert.sameValue(byName("Blue") | byName("Red"), 5);
