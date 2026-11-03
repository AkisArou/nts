/*---
description: Explicit digit-loop control for unary plus preserves the sign of long zero decimals in a declared class field.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// Control: Unary plus: a class field carries every sign and zero spelling; node preserves negative zero after exactly twenty fractional zeros and surrounding whitespace.
function space(code: number): boolean { return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 || code >= 8192 && code <= 8202 || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233; }
function zeroDecimal(text: string): number {
  let i = 0, end = text.length; while (i < end && space(text.charCodeAt(i))) i++;
  while (end > i && space(text.charCodeAt(end - 1))) end--;
  const negative = text[i] === "-"; if (negative || text[i] === "+") i++;
  let value = 0, scale = 1, fractional = false;
  for (; i < end; i++) { const code = text.charCodeAt(i); if (code === 46 && !fractional) { fractional = true; continue; } if (code < 48 || code > 57) return NaN; value = value * 10 + code - 48; if (fractional) scale *= 10; }
  return negative ? -(value / scale) : value / scale;
}
class ZeroText { text: string; constructor(text: string) { this.text = text; } }
function read(input: ZeroText): number { return zeroDecimal(input.text); }
const spellings: string[] = ["0", "000000000000000000000000", "0.00000000000000000000", ".00000000000000000000", "000.000"];
for (const digits of spellings) for (const sign of ["", "+", "-"]) {
  const text = "\u00a0" + sign + digits + "\ufeff", input = new ZeroText(text);
  assert.sameValue(read(input), sign === "-" ? -0 : 0);
  assert.sameValue(input.text, text);
}
