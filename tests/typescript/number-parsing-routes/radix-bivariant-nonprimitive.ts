/*---
description: Exhausting both primitive-conversion hooks throws TypeError at the correct argument boundary.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-errors, ts-interfaces, ts-generics, ts-objects, ts-unknown, ts-unions, ts-to-primitive, ts-unsound-bivariance]
---*/
// parseInt crosses a widened method interface; node tries both text hooks before touching radix, or both radix hooks after text, and throws TypeError when neither hook returns a primitive.
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface RadixValue { valueOf(): unknown; toString(): unknown; }
interface Parser<S, R> { parse(text: S, radix: R): number; }
const narrow: Parser<string, number> = { parse: parseInt }, parser: Parser<string | TextValue, number | RadixValue> = narrow;
const log: string[] = [], rows: [string, number][] = [["11#", 3], ["-0#", -0], ["", NaN]];
for (const [text, expected] of rows) for (const mode of ["ok", "text", "radix"]) {
  log.length = 0;
  const input: TextValue = {
    toString(): unknown { log.push("text.toString"); return mode === "text" ? {} : text; },
    valueOf(): unknown { log.push("text.valueOf"); return {}; }
  };
  const radix: RadixValue = { valueOf(): unknown { log.push("radix.valueOf"); return mode === "radix" ? {} : 2; }, toString(): unknown { log.push("radix.toString"); return {}; } };
  if (mode === "ok") assert.sameValue(parser.parse(input, radix), expected, text); else assert.throws(TypeError, () => parser.parse(input, radix));
  const expectedLog = mode === "text" ? ["text.toString", "text.valueOf"] : mode === "radix" ? ["text.toString", "radix.valueOf", "radix.toString"] : ["text.toString", "radix.valueOf"];
  assert.compareArray(log, expectedLog);
}
