/*---
description: Both radix conversion hooks throw only after text conversion even when the text has no integer prefix.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-errors, ts-interfaces, ts-generics, ts-objects, ts-unknown, ts-unions, ts-to-primitive, ts-unsound-bivariance]
---*/
// parseInt crosses a widened method interface; node finishes text.toString before a SyntaxError from either radix hook, even for empty, sign-only or nonnumeric text.
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface RadixValue { valueOf(): unknown; toString(): unknown; }
interface Parser<S, R> { parse(text: S, radix: R): number; }
const narrow: Parser<string, number> = { parse: parseInt }, parser: Parser<string | TextValue, number | RadixValue> = narrow;
const log: string[] = [], rows: [string, number][] = [["11#", 3], ["-0#", -0], ["", NaN], ["bad", NaN], ["+", NaN]];
for (const [text, expected] of rows) for (const mode of ["ok", "value-throw", "string-throw"]) {
  log.length = 0;
  const input: TextValue = { toString(): unknown { log.push("text.toString"); return text; }, valueOf(): unknown { log.push("text.valueOf"); return "99"; } };
  const radix: RadixValue = {
    valueOf(): unknown { log.push("radix.valueOf"); if (mode === "value-throw") throw new SyntaxError(); return mode === "string-throw" ? {} : 2; },
    toString(): unknown { log.push("radix.toString"); throw new SyntaxError(); }
  };
  if (mode === "ok") assert.sameValue(parser.parse(input, radix), expected, text); else assert.throws(SyntaxError, () => parser.parse(input, radix));
  assert.compareArray(log, mode === "string-throw" ? ["text.toString", "radix.valueOf", "radix.toString"] : ["text.toString", "radix.valueOf"]);
}
