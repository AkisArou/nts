/*---
description: "Explicit hook and code-unit scanner control for a widened method interface admits stored BigInt calls on objects with exact numeric-hint hook order and string syntax refusals."
features: [ts-number-parsing-routes, ts-number-parsing-route-values, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-conversions, ts-interfaces, ts-objects, ts-errors, ts-to-primitive, ts-unknown, ts-unions, ts-tuples, ts-unsound-bivariance, ts-bigint, ts-typeof-operator]
---*/
// BigInt crosses a bivariant method interface; node tries valueOf before toString, keeps exact integer strings and throws SyntaxError for fractional, exponent and suffix strings.
interface TextValue { valueOf(): unknown; toString(): unknown; }
interface NarrowParser { parse(text: string): bigint; }
interface WideParser { parse(text: string | TextValue): bigint; }
function space(code: number): boolean {
  return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 65279 || code === 5760 || code >= 8192 && code <= 8202 || code === 8239 || code === 8287 || code === 12288 || code === 10 || code === 13 || code === 8232 || code === 8233;
}
function integer(text: string): bigint {
  let first = 0, last = text.length;
  while (first < last && space(text.charCodeAt(first))) first++;
  while (last > first && space(text.charCodeAt(last - 1))) last--;
  if (first === last) return 0n;
  const negative = text.charCodeAt(first) === 45; if (negative || text.charCodeAt(first) === 43) first++;
  if (first === last) throw new SyntaxError();
  const digits: bigint[] = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]; let result = 0n;
  for (; first < last; first++) { const digit = text.charCodeAt(first) - 48; if (digit < 0 || digit > 9) throw new SyntaxError(); result = result * 10n + digits[digit]; }
  return negative ? -result : result;
}
const narrow: NarrowParser = { parse(input: string | TextValue): bigint {
  let text: unknown = typeof input === "string" ? input : input.valueOf();
  if (typeof text !== "string" && typeof input !== "string") text = input.toString();
  if (typeof text !== "string") throw new TypeError(); return integer(text);
} }, parser: WideParser = narrow;
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
