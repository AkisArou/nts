/*---
description: Leading decimal zeros never select legacy octal when an interface reader returns the text.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-interfaces, ts-objects, ts-closures, ts-tuples]
---*/
// All four number parsers read one interface method result; node keeps decimal 077/08/09, while only the decimal parsers continue through dot and exponent.
interface DecimalReader { read(): string; }
function consume(input: DecimalReader): number[] { const text = input.read(); return [parseInt(text), parseFloat(text), Number(text), +text]; }
const bodies: [string, number, number][] = [["77", 77, 77], ["08", 8, 8], ["09", 9, 9], ["12.5", 12, 12.5], ["1e3", 1, 1000], ["", 0, 0]];
for (const count of [1, 2, 5]) for (const [body, integer, decimal] of bodies) for (const sign of ["", "+", "-"]) {
  let zeros = ""; for (let i = 0; i < count; i++) zeros += "0";
  const text = sign + zeros + body, input: DecimalReader = { read(): string { return text; } }, factor = sign === "-" ? -1 : 1;
  assert.compareArray(consume(input), [factor * integer, factor * decimal, factor * decimal, factor * decimal], text);
  assert.sameValue(input.read(), text);
}
