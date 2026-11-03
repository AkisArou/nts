/*---
description: A nonprimitive text toString result falls back to valueOf before any radix conversion.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-interfaces, ts-generics, ts-objects, ts-unknown, ts-unions, ts-to-primitive, ts-unsound-bivariance]
---*/
// parseInt crosses a widened method interface; node finishes text.toString/valueOf fallback before radix.valueOf and then uses the selected exact digit alphabet.
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface RadixValue { valueOf(): unknown; toString(): unknown; }
interface Parser<S, R> { parse(text: S, radix: R): number; }
const narrow: Parser<string, number> = { parse: parseInt }, parser: Parser<string | TextValue, number | RadixValue> = narrow;
const log: string[] = [], rows: [number, number][] = [[2, 3], [16, 17], [36, 37], [37, NaN], [4294967312, 17]];
for (const [selected, expected] of rows) for (const fallback of [false, true]) for (const sign of ["", "+", "-"]) {
  log.length = 0; const text = sign + "11#", factor = sign === "-" ? -1 : 1;
  const input: TextValue = {
    toString(): unknown { log.push("text.toString"); return fallback ? {} : text; },
    valueOf(): unknown { log.push("text.valueOf"); return text; }
  };
  const radix: RadixValue = {
    valueOf(): unknown { log.push("radix.valueOf"); return selected; },
    toString(): unknown { log.push("radix.toString"); return "10"; }
  };
  assert.sameValue(parser.parse(input, radix), factor * expected, text);
  assert.compareArray(log, fallback ? ["text.toString", "text.valueOf", "radix.valueOf"] : ["text.toString", "radix.valueOf"]);
}
