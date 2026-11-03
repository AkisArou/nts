/*---
description: Unary plus requires complete unsigned prefixes after narrowing either declared string carrier arm.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-tuples]
---*/
// Unary plus reads either narrowed union field; node accepts complete unsigned nondecimal forms and returns NaN for every signed or partial prefix.
type PrefixInput = { kind: "direct"; text: string } | { kind: "fallback"; fallback: string };
function consume(input: PrefixInput): number { if (input.kind === "direct") return +input.text; return +input.fallback; }
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
