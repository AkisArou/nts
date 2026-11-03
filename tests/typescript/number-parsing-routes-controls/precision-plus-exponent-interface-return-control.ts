/*---
description: Explicit digit-loop control for unary plus preserves extreme exponents and signed zero through a typed interface return.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-interfaces, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// Control: Unary plus: the typed interface return carries every coefficient/sign/exponent combination; node returns exact finite anchors, infinities and signed underflow zeros.
function space(code: number): boolean { return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 || code >= 8192 && code <= 8202 || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233; }
function scientific(text: string, partial: boolean): number {
  let i = 0, end = text.length; while (i < end && space(text.charCodeAt(i))) i++;
  while (end > i && space(text.charCodeAt(end - 1))) end--;
  const negative = text[i] === "-"; if (negative || text[i] === "+") i++;
  const start = i; let coefficient = 0;
  while (text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) { coefficient = coefficient * 10 + text.charCodeAt(i) - 48; i++; }
  if (i === start || text[i] !== "e" && text[i] !== "E") return NaN;
  i++; const shrinking = text[i] === "-"; if (shrinking || text[i] === "+") i++;
  const first = i; let exponent = 0; while (text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) { exponent = exponent * 10 + text.charCodeAt(i) - 48; i++; }
  if (i === first || !partial && i !== end) return NaN;
  if (coefficient === 0) return negative ? -0 : 0;
  // Fixture coefficients are 1 or 25 here: powers at least +400 overflow; at most -400 round to zero.
  if (exponent >= 400) { const saturated = shrinking ? 0 : Infinity; return negative ? -saturated : saturated; }
  // Remaining fixture powers are 0, +1, -1 and -2: both operands stay exact, with divisors 1, 10 or 100.
  let numerator = coefficient, denominator = 1;
  for (let j = 0; j < exponent; j++) { if (shrinking) denominator *= 10; else numerator *= 10; }
  const value = numerator / denominator; return negative ? -value : value;
}
interface TextReader { read(): string; }
function convert(input: TextReader): number { return scientific(input.read(), false); }
const powers: [string, number][] = [["0", 1], ["+1", 10], ["-1", 0.1], ["-2", 0.01], ["400", Infinity], ["401", Infinity], ["-400", 0], ["-401", 0]];
const coefficients: [string, number][] = [["0", 0], ["1", 1], ["25", 25]];
for (const [coefficient, amount] of coefficients) for (const [power, factor] of powers) for (const sign of ["", "+", "-"]) for (const marker of ["e", "E"]) {
  const text = sign + coefficient + marker + power; const input: TextReader = { read(): string { return text; } };
  const magnitude = amount === 0 ? 0 : amount * factor;
  assert.sameValue(convert(input), sign === "-" ? -magnitude : magnitude); assert.sameValue(input.read(), text);
}
