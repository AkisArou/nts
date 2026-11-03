/*---
description: A radix object falls back from valueOf to an integer string before ToInt32 selects its alphabet.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-interfaces, ts-generics, ts-objects, ts-unknown, ts-unions, ts-to-primitive, ts-unsound-bivariance]
---*/
// parseInt crosses a widened method interface; node converts text first, then falls back from radix.valueOf to radix.toString and wraps the resulting numeric value.
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface RadixValue { valueOf(): unknown; toString(): unknown; }
interface Parser<S, R> { parse(text: S, radix: R): number; }
const narrow: Parser<string, number> = { parse: parseInt }, parser: Parser<string | TextValue, number | RadixValue> = narrow;
const log: string[] = [], rows: [string, number, number][] = [["0", 0, 11], ["2", 2, 3], ["16", 16, 17], ["36", 36, 37], ["37", 37, NaN], ["4294967312", 4294967312, 17], ["-4294967280", -4294967280, 17]];
for (const [digits, selected, expected] of rows) for (const fallback of [false, true]) {
  log.length = 0; const text = "-11#";
  const input: TextValue = { toString(): unknown { log.push("text.toString"); return text; }, valueOf(): unknown { log.push("text.valueOf"); return "99"; } };
  const radix: RadixValue = {
    valueOf(): unknown { log.push("radix.valueOf"); return fallback ? {} : selected; },
    toString(): unknown { log.push("radix.toString"); return digits; } };
  assert.sameValue(parser.parse(input, radix), -expected, digits);
  assert.compareArray(log, fallback ? ["text.toString", "radix.valueOf", "radix.toString"] : ["text.toString", "radix.valueOf"]);
}
