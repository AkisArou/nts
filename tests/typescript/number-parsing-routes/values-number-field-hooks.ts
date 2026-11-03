/*---
description: "Number stored in a declared callable field parses object-provided strings with valueOf-first order and exact fallback and throwing behavior."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-conversions, ts-interfaces, ts-objects, ts-errors, ts-to-primitive, ts-unknown, ts-unions, ts-tuples]
---*/
// Number crosses a callable interface field with object arguments; node tries valueOf before toString, parses the whole returned string and propagates exact hook errors.
interface TextValue { valueOf(): unknown; toString(): unknown; }
interface NumberParser { parse: (value: TextValue) => number; }
const parser: NumberParser = { parse: Number };
const log: string[] = [], modes: string[] = ["text", "fallback", "nonprimitive", "throw-value", "throw-string"];
const rows: [string, number][] = [["-7.25", -7.25], ["-0", -0], ["12tail", NaN], ["", 0]];
for (const [part, expected] of rows) for (const mode of modes) {
  log.length = 0; const text = " " + part + " ";
  const input: TextValue = {
    valueOf(): unknown { log.push("valueOf"); if (mode === "throw-value") throw new RangeError(); return mode === "text" ? text : {}; },
    toString(): unknown { log.push("toString"); if (mode === "throw-string") throw new URIError(); return mode === "nonprimitive" ? {} : text; }
  };
  if (mode === "nonprimitive") assert.throws(TypeError, () => parser.parse(input));
  else if (mode === "throw-value") assert.throws(RangeError, () => parser.parse(input));
  else if (mode === "throw-string") assert.throws(URIError, () => parser.parse(input));
  else assert.sameValue(parser.parse(input), expected);
  assert.compareArray(log, mode === "text" || mode === "throw-value" ? ["valueOf"] : ["valueOf", "toString"]);
}
