/*---
description: An abrupt text toString completion prevents every radix hook through a bivariant parser method.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-errors, ts-interfaces, ts-generics, ts-objects, ts-unknown, ts-unions, ts-to-primitive, ts-unsound-bivariance]
---*/
// parseInt crosses a widened method interface; node propagates RangeError from text.toString without consulting radix, while successful text conversion still visits radix for invalid digits.
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface RadixValue { valueOf(): unknown; toString(): unknown; }
interface Parser<S, R> { parse(text: S, radix: R): number; }
const narrow: Parser<string, number> = { parse: parseInt }, parser: Parser<string | TextValue, number | RadixValue> = narrow;
const log: string[] = [], rows: [string, number][] = [["11#", 3], ["-0#", -0], ["bad", NaN], ["", NaN]];
for (const [text, expected] of rows) for (const fail of [false, true]) {
  log.length = 0;
  const input: TextValue = {
    toString(): unknown { log.push("text.toString"); if (fail) throw new RangeError(); return text; },
    valueOf(): unknown { log.push("text.valueOf"); return "99"; }
  };
  const radix: RadixValue = { valueOf(): unknown { log.push("radix.valueOf"); return 2; }, toString(): unknown { log.push("radix.toString"); return "10"; } };
  if (fail) assert.throws(RangeError, () => parser.parse(input, radix)); else assert.sameValue(parser.parse(input, radix), expected, text);
  assert.compareArray(log, fail ? ["text.toString"] : ["text.toString", "radix.valueOf"]);
}
