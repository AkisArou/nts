/*---
description: Unary plus preserves extreme exponents and signed zero through a typed interface return.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-interfaces, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// Unary plus: the typed interface return carries every coefficient/sign/exponent combination; node returns exact finite anchors, infinities and signed underflow zeros.
interface TextReader { read(): string; }
function convert(input: TextReader): number { return +input.read(); }
const powers: [string, number][] = [["0", 1], ["+1", 10], ["-1", 0.1], ["-2", 0.01], ["400", Infinity], ["401", Infinity], ["-400", 0], ["-401", 0]];
const coefficients: [string, number][] = [["0", 0], ["1", 1], ["25", 25]];
for (const [coefficient, amount] of coefficients) for (const [power, factor] of powers) for (const sign of ["", "+", "-"]) for (const marker of ["e", "E"]) {
  const text = sign + coefficient + marker + power; const input: TextReader = { read(): string { return text; } };
  const magnitude = amount === 0 ? 0 : amount * factor;
  assert.sameValue(convert(input), sign === "-" ? -magnitude : magnitude); assert.sameValue(input.read(), text);
}
