/*---
description: Explicit code-unit control for Unary plus requires complete unsigned prefixes after narrowing either declared string carrier arm.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-tuples]
---*/
// Unary plus reads either narrowed union field; node accepts complete unsigned nondecimal forms and returns NaN for every signed or partial prefix.
function white(c: number): boolean {
  return c === 9 || c === 11 || c === 12 || c === 32 || c === 160 || c === 65279 || c === 5760 ||
    (c >= 8192 && c <= 8202) || c === 8239 || c === 8287 || c === 12288 || c === 10 || c === 13 || c === 8232 || c === 8233;
}
function scan(text: string): number {
  let i = 0, end = text.length, sign = 1, signed = false, radix = 10, value = 0, count = 0;
  while (i < end && white(text.charCodeAt(i))) i++;
  while (end > i && white(text.charCodeAt(end - 1))) end--;
  if (i === end) return 0;
  if (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45) { signed = true; if (text.charCodeAt(i) === 45) sign = -1; i++; }
  const marker = text.charCodeAt(i + 1);
  if (text.charCodeAt(i) === 48) {
    if (marker === 120 || marker === 88) radix = 16;
    else if (marker === 98 || marker === 66) radix = 2;
    else if (marker === 111 || marker === 79) radix = 8;
    if (radix !== 10) { if (signed) return NaN; i += 2; }
  }
  for (; i < end; i++) {
    const c = text.charCodeAt(i), digit = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 90 ? c - 55 : c >= 97 && c <= 122 ? c - 87 : -1;
    if (digit < 0 || digit >= radix) return NaN;
    value = value * radix + digit; count++;
  }
  return count === 0 ? NaN : sign * value;
}
type PrefixInput = { kind: "direct"; text: string } | { kind: "fallback"; fallback: string };
function consume(input: PrefixInput): number { if (input.kind === "direct") return scan(input.text); return scan(input.fallback); }
const prefixes: [string, number, string, number, string][] = [
  ["0x", 16, "aF", 175, "g"], ["0X", 16, "Ff", 255, "G"], ["0b", 2, "101", 5, "2"],
  ["0B", 2, "110", 6, "2"], ["0o", 8, "77", 63, "8"], ["0O", 8, "71", 57, "8"]
];
for (const [prefix, radix, extra, extraValue, invalidDigit] of prefixes) {
  const digits: [string, number][] = [["10", radix], ["11", radix + 1], ["000", 0], [extra, extraValue], ["", NaN]];
  for (const [body, value] of digits) for (const sign of ["", "+", "-"]) for (const suffix of ["", invalidDigit, "q", "_1", ".0"]) {
    const text = sign + prefix + body + suffix, inputs: PrefixInput[] = [{ kind: "direct", text }, { kind: "fallback", fallback: text }];
    const expected = sign === "" && suffix === "" ? value : NaN;
    for (const input of inputs) assert.sameValue(consume(input), expected, text);
  }
}
