/*---
description: "A widened method interface admits stored BigInt calls on objects with exact numeric-hint hook order and string syntax refusals."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-conversions, ts-interfaces, ts-objects, ts-errors, ts-to-primitive, ts-unknown, ts-unions, ts-tuples, ts-unsound-bivariance, ts-bigint]
---*/
// BigInt crosses a bivariant method interface; node tries valueOf before toString, keeps exact integer strings and throws SyntaxError for fractional, exponent and suffix strings.
interface TextValue { valueOf(): unknown; toString(): unknown; }
interface NarrowParser { parse(text: string): bigint; }
interface WideParser { parse(text: string | TextValue): bigint; }
const narrow: NarrowParser = { parse: BigInt }, parser: WideParser = narrow;
const log: string[] = [], modes: string[] = ["text", "fallback", "nonprimitive", "throw-value", "throw-string"];
const rows: [string, bigint | undefined][] = [["-37", -37n], ["-0", 0n], ["", 0n], ["1.5", undefined], ["1e3", undefined], ["1n", undefined]];
for (const [part, expected] of rows) for (const mode of modes) {
  log.length = 0; const text = " " + part + " ";
  const input: TextValue = {
    valueOf(): unknown { log.push("valueOf"); if (mode === "throw-value") throw new RangeError(); return mode === "text" ? text : {}; },
    toString(): unknown { log.push("toString"); if (mode === "throw-string") throw new URIError(); return mode === "nonprimitive" ? {} : text; }
  };
  if (mode === "nonprimitive") assert.throws(TypeError, () => parser.parse(input));
  else if (mode === "throw-value") assert.throws(RangeError, () => parser.parse(input));
  else if (mode === "throw-string") assert.throws(URIError, () => parser.parse(input));
  else if (expected === undefined) assert.throws(SyntaxError, () => parser.parse(input));
  else assert.sameValue(parser.parse(input), expected);
  assert.compareArray(log, mode === "text" || mode === "throw-value" ? ["valueOf"] : ["valueOf", "toString"]);
}
