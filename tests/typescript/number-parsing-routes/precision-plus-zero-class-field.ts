/*---
description: Unary plus preserves the sign of long zero decimals in a declared class field.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// Unary plus: a class field carries every sign and zero spelling; node preserves negative zero after exactly twenty fractional zeros and surrounding whitespace.
class ZeroText { text: string; constructor(text: string) { this.text = text; } }
function read(input: ZeroText): number { return +input.text; }
const spellings: string[] = ["0", "000000000000000000000000", "0.00000000000000000000", ".00000000000000000000", "000.000"];
for (const digits of spellings) for (const sign of ["", "+", "-"]) {
  const text = "\u00a0" + sign + digits + "\ufeff", input = new ZeroText(text);
  assert.sameValue(read(input), sign === "-" ? -0 : 0);
  assert.sameValue(input.text, text);
}
