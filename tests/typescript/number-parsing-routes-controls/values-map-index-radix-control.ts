/*---
description: "Explicit code-unit scanner control for typed parser callbacks passed to map distinguish its index radix from the extra arguments ignored by the other parsers."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-bigint, ts-conversions, ts-type-aliases, ts-unions, ts-tuples, ts-closures, ts-overloads, ts-optional-parameters]
---*/
// parseInt, parseFloat, Number and BigInt cross typed map callbacks; node returns [1, NaN, NaN] for map(parseInt), while other parsers convert every element normally.
type Parsed = number | bigint;
type Parser = (text: string, radix?: number) => Parsed;
type NumericParser = (text: string, radix?: number) => number;
type BigParser = (text: string) => bigint;
// Fixture scanner: modes 0/1/2/3 are integer-prefix, decimal-prefix, whole-number and bigint.
function space(code: number): boolean {
  return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 || code >= 8192 && code <= 8202 || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233;
}
function scanner(mode: 0 | 1 | 2): NumericParser;
function scanner(mode: 3): BigParser;
function scanner(mode: number): Parser {
  return (text: string, radix?: number): Parsed => {
    let first = 0, last = text.length;
    while (first < last && space(text.charCodeAt(first))) first++;
    if (mode >= 2) while (last > first && space(text.charCodeAt(last - 1))) last--;
    const blank = first === last, negative = text.charCodeAt(first) === 45;
    if (negative || text.charCodeAt(first) === 43) first++;
    const base = mode === 0 ? ((radix === undefined ? 0 : radix | 0) || 10) : 10;
    if (base < 2 || base > 36) return NaN;
    let integer = 0, divisor = 1, digits = 0, fraction = false, exact = 0n;
    const bigDigits: bigint[] = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n];
    for (; first < last; first++) {
      const code = text.charCodeAt(first), digit = code - 48;
      if (code === 46 && mode !== 0 && !fraction) { fraction = true; continue; }
      if (digit < 0 || digit > 9 || digit >= base) break;
      integer = integer * base + digit; exact = exact * 10n + bigDigits[digit]; digits++; if (fraction) divisor *= 10;
    }
    if (mode === 3) { if (fraction || first !== last || !digits && !blank) throw new SyntaxError(); return negative ? -exact : exact; }
    if (mode === 2 && first !== last) return NaN;
    return !digits ? (mode === 2 && blank ? 0 : NaN) : (negative ? -integer : integer) / divisor;
  };
}
const integerParser = scanner(0), floatParser = scanner(1), numberParser = scanner(2), bigintParser = scanner(3);
const parsers: Parser[] = [integerParser, floatParser, numberParser, bigintParser];
const rows: [string[], Parsed[][]][] = [
  [["1", "2", "3"], [[1, NaN, NaN], [1, 2, 3], [1, 2, 3], [1n, 2n, 3n]]],
  [["10", "10", "10", "10", "10"], [[10, NaN, 2, 3, 4], [10, 10, 10, 10, 10], [10, 10, 10, 10, 10], [10n, 10n, 10n, 10n, 10n]]],
  [["-0", "-0", "-0"], [[-0, NaN, -0], [-0, -0, -0], [-0, -0, -0], [0n, 0n, 0n]]]
];
for (const [parts, expected] of rows) {
  const texts: string[] = []; for (const part of parts) texts.push(" " + part + " ");
  for (let index = 0; index < parsers.length; index++) assert.compareArray(texts.map(parsers[index]), expected[index]);
}
