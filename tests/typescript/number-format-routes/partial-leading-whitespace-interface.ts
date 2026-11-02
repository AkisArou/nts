/*---
description: "An interface reader returns each Unicode whitespace boundary before both partial parsers."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings, ts-interfaces, ts-objects, ts-closures, ts-tuples]
---*/
// A typed reader method is called once for each original string; text and both numeric results are logged. Node trims ECMAScript whitespace and line terminators but rejects NEL, Mongolian vowel separator and zero-width format characters.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const inputs: string[] = [
  "-0.5tail", "\t-0.5tail", "\u000b-0.5tail", "\f-0.5tail",
  " -0.5tail", "\u00a0-0.5tail", "\u1680-0.5tail", "\u2000-0.5tail",
  "\u2001-0.5tail", "\u2002-0.5tail", "\u2003-0.5tail", "\u2004-0.5tail",
  "\u2005-0.5tail", "\u2006-0.5tail", "\u2007-0.5tail", "\u2008-0.5tail",
  "\u2009-0.5tail", "\u200a-0.5tail", "\u202f-0.5tail", "\u205f-0.5tail",
  "\u3000-0.5tail", "\ufeff-0.5tail", "\n-0.5tail", "\r-0.5tail",
  "\r\n-0.5tail", "\u2028-0.5tail", "\u2029-0.5tail", "\u0085-0.5tail",
  "\u180e-0.5tail", "\u200b-0.5tail", "\u200c-0.5tail",
];
const integers: number[] = [
  -0, -0, -0, -0, -0, -0, -0, -0, -0, -0,
  -0, -0, -0, -0, -0, -0, -0, -0, -0, -0,
  -0, -0, -0, -0, -0, -0, -0, NaN, NaN, NaN,
  NaN,
];
const fractions: number[] = [
  -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5,
  -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5,
  -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, NaN, NaN, NaN,
  NaN,
];
const log: unknown[] = [], wanted: unknown[] = [];
interface TextReader { read(): string; }
function consume(text: string, index: number): [number, number] {
  const reader: TextReader = { read(): string { log.push("read", index); return text; } };
  const observed = reader.read(); same(observed, inputs[index]);
  const integer = parseInt(observed, 10), fraction = parseFloat(observed);
  same(integer, integers[index]); same(fraction, fractions[index]); log.push(observed, integer, fraction);
  return [integer, fraction];
}
for (let index = 0; index < inputs.length; index++) {
  const values = consume(inputs[index], index); same(values[0], integers[index]); same(values[1], fractions[index]);
  wanted.push("read", index, inputs[index], integers[index], fractions[index]);
}
assert.compareArray(log, wanted);
