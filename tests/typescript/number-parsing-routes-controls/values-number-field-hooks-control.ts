/*---
description: "Explicit hook and code-unit scanner control for number stored in a declared callable field parses object-provided strings with valueOf-first order and exact fallback and throwing behavior."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-conversions, ts-interfaces, ts-objects, ts-errors, ts-to-primitive, ts-unknown, ts-unions, ts-tuples, ts-typeof-operator]
---*/
// Number crosses a callable interface field with object arguments; node tries valueOf before toString, parses the whole returned string and propagates exact hook errors.
interface TextValue { valueOf(): unknown; toString(): unknown; }
interface NumberParser { parse: (value: TextValue) => number; }
function space(code: number): boolean {
  return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 || code >= 8192 && code <= 8202 || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233;
}
function decimal(text: string, whole: boolean, floating: boolean): number {
  let first = 0, last = text.length;
  while (first < last && space(text.charCodeAt(first))) first++;
  if (whole) while (last > first && space(text.charCodeAt(last - 1))) last--;
  if (whole && first === last) return 0;
  const negative = text.charCodeAt(first) === 45; if (negative || text.charCodeAt(first) === 43) first++;
  let value = 0, divisor = 1, digits = 0, fraction = false;
  for (; first < last; first++) {
    const code = text.charCodeAt(first), digit = code - 48;
    if (floating && code === 46 && !fraction) { fraction = true; continue; }
    if (digit < 0 || digit > 9) break;
    value = value * 10 + digit; digits++; if (fraction) divisor *= 10;
  }
  return !digits || whole && first !== last ? NaN : (negative ? -value : value) / divisor;
}
const parser: NumberParser = { parse(value: TextValue): number {
  let text: unknown = value.valueOf(); if (typeof text !== "string") text = value.toString();
  if (typeof text !== "string") throw new TypeError(); return decimal(text, true, true);
} };
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
