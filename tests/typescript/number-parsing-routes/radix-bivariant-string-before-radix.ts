/*---
description: Object text conversion mutates the radix before its numeric hook is consulted through a bivariant parser method.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-interfaces, ts-generics, ts-objects, ts-unknown, ts-unions, ts-to-primitive, ts-unsound-bivariance]
---*/
// parseInt crosses a widened method interface; node calls text.toString before radix.valueOf, so the text hook selects the actual radix and both unused hooks stay uncalled.
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface RadixValue { valueOf(): unknown; toString(): unknown; }
interface Parser<S, R> { parse(text: S, radix: R): number; }
const narrow: Parser<string, number> = { parse: parseInt }, parser: Parser<string | TextValue, number | RadixValue> = narrow;
const log: string[] = [], rows: [number, number][] = [[0, 11], [2, 3], [16, 17], [36, 37], [37, NaN], [2.9, 3], [4294967312, 17], [9007199254740992, 11]];
for (const [selected, expected] of rows) for (const sign of ["", "+", "-"]) {
  let current = 10; log.length = 0; const text = sign + "11#", factor = sign === "-" ? -1 : 1;
  const input: TextValue = {
    toString(): unknown { log.push("text.toString"); current = selected; return text; },
    valueOf(): unknown { log.push("text.valueOf"); return "99"; }
  };
  const radix: RadixValue = {
    valueOf(): unknown { log.push("radix.valueOf"); return current; },
    toString(): unknown { log.push("radix.toString"); return "10"; }
  };
  assert.sameValue(parser.parse(input, radix), factor * expected, text);
  assert.compareArray(log, ["text.toString", "radix.valueOf"]); assert.sameValue(current, selected);
}
