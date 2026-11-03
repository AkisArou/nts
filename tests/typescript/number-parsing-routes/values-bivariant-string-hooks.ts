/*---
description: "Method-parameter bivariance admits object calls to stored parseInt and parseFloat values with exact string-hint hook order and abrupt completion."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-conversions, ts-interfaces, ts-objects, ts-errors, ts-to-primitive, ts-unknown, ts-unions, ts-tuples, ts-unsound-bivariance]
---*/
// parseInt/parseFloat cross a widened method interface; node tries toString before valueOf, preserves parsed zero signs, and stops at the first thrown hook.
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface NarrowParser { parse(text: string): number; }
interface WideParser { parse(text: string | TextValue): number; }
const targets: ((text: string) => number)[] = [parseInt, parseFloat];
const log: string[] = [], modes: string[] = ["text", "fallback", "nonprimitive", "throw-string", "throw-value"];
const rows: [string, number[]][] = [["-7.25tail", [-7, -7.25]], ["-0rest", [-0, -0]], [".5tail", [NaN, 0.5]], ["bad", [NaN, NaN]]];
for (let index = 0; index < targets.length; index++) {
  const narrow: NarrowParser = { parse: targets[index] }, parser: WideParser = narrow;
  for (const [part, expected] of rows) for (const mode of modes) {
    log.length = 0; const text = " " + part + " ";
    const input: TextValue = {
      toString(): unknown { log.push("toString"); if (mode === "throw-string") throw new RangeError(); return mode === "text" ? text : {}; },
      valueOf(): unknown { log.push("valueOf"); if (mode === "throw-value") throw new URIError(); return mode === "nonprimitive" ? {} : text; }
    };
    if (mode === "nonprimitive") assert.throws(TypeError, () => parser.parse(input));
    else if (mode === "throw-string") assert.throws(RangeError, () => parser.parse(input));
    else if (mode === "throw-value") assert.throws(URIError, () => parser.parse(input));
    else assert.sameValue(parser.parse(input), expected[index]);
    assert.compareArray(log, mode === "text" || mode === "throw-string" ? ["toString"] : ["toString", "valueOf"]);
  }
}
