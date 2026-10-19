/*---
description: A type guard checks at run time the pattern a template literal type describes.
features: [ts-literal-types, ts-template-literal-types, ts-type-guards]
---*/
type HexColor = `#${string}`;
function isHex(value: string): value is HexColor {
  return value.startsWith("#") && /^#[0-9a-f]{3,6}$/i.test(value);
}
function toRgb(color: HexColor): number {
  return parseInt(color.slice(1), 16);
}
const inputs = ["#ff0000", "red", "#0f0"];
assert.compareArray(inputs.filter(isHex).map(toRgb), [16711680, 240]);
