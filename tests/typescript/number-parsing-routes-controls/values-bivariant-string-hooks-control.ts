/*---
description: "Explicit hook and code-unit scanner control for method-parameter bivariance admits object calls to stored parseInt and parseFloat values with exact string-hint hook order and abrupt completion."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-conversions, ts-interfaces, ts-objects, ts-errors, ts-to-primitive, ts-unknown, ts-unions, ts-tuples, ts-unsound-bivariance, ts-typeof-operator, ts-closures]
---*/
// parseInt/parseFloat cross a widened method interface; node tries toString before valueOf, preserves parsed zero signs, and stops at the first thrown hook.
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface NarrowParser { parse(text: string): number; }
interface WideParser { parse(text: string | TextValue): number; }
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
function manual(floating: boolean): (text: string) => number {
  return (input: string | TextValue): number => {
    let text: unknown = typeof input === "string" ? input : input.toString();
    if (typeof text !== "string" && typeof input !== "string") text = input.valueOf();
    if (typeof text !== "string") throw new TypeError();
    return decimal(text, false, floating);
  };
}
const targets: ((text: string) => number)[] = [manual(false), manual(true)];
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
