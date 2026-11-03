/*---
description: parseFloat preserves extreme exponents and signed zero through a typed generic.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-generics, ts-generic-constraints, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// parseFloat: the typed generic carries every coefficient/sign/exponent combination; node returns exact finite anchors, infinities and signed underflow zeros.
function read<T extends { text: string }>(input: T): number { return parseFloat(input.text); }
const powers: [string, number][] = [["0", 1], ["+1", 10], ["-1", 0.1], ["-2", 0.01], ["400", Infinity], ["401", Infinity], ["-400", 0], ["-401", 0]];
const coefficients: [string, number][] = [["0", 0], ["1", 1], ["25", 25]];
for (const [coefficient, amount] of coefficients) for (const [power, factor] of powers) for (const sign of ["", "+", "-"]) for (const marker of ["e", "E"]) {
  const text = sign + coefficient + marker + power + "units"; const input = { text, label: "fraction" };
  const magnitude = amount === 0 ? 0 : amount * factor;
  assert.sameValue(read(input), sign === "-" ? -magnitude : magnitude); assert.sameValue(input.text, text);
}
