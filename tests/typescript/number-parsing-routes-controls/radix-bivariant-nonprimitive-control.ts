/*---
description: Explicit conversion and code-unit control for Exhausting both primitive-conversion hooks throws TypeError at the correct argument boundary.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-errors, ts-interfaces, ts-generics, ts-objects, ts-unknown, ts-unions, ts-to-primitive, ts-unsound-bivariance, ts-typeof-operator]
---*/
// parseInt crosses a widened method interface; node tries both text hooks before touching radix, or both radix hooks after text, and throws TypeError when neither hook returns a primitive.
function white(c: number): boolean { return c === 9 || c === 11 || c === 12 || c === 32 || c === 160 || c === 65279 || c === 5760 ||
    (c >= 8192 && c <= 8202) || c === 8239 || c === 8287 || c === 12288 || c === 10 || c === 13 || c === 8232 || c === 8233;
}
function int32(value: number | undefined): number {
  if (value === undefined || value !== value || value === Infinity || value === -Infinity) return 0;
  let result = (value - value % 1) % 4294967296; if (result < 0) result += 4294967296;
  return result >= 2147483648 ? result - 4294967296 : result;
}
function scan(text: string, raw?: number): number {
  let i = 0, sign = 1, value = 0, count = 0;
  while (i < text.length && white(text.charCodeAt(i))) i++;
  if (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45) { if (text.charCodeAt(i) === 45) sign = -1; i++; }
  let radix = int32(raw); const strip = radix === 0 || radix === 16;
  if (radix !== 0 && (radix < 2 || radix > 36)) return NaN;
  if (radix === 0) radix = 10;
  if (strip && text.charCodeAt(i) === 48 && (text.charCodeAt(i + 1) === 120 || text.charCodeAt(i + 1) === 88)) { radix = 16; i += 2; }
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i), digit = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 90 ? c - 55 : c >= 97 && c <= 122 ? c - 87 : -1;
    if (digit < 0 || digit >= radix) break; value = value * radix + digit; count++;
  }
  return count === 0 ? NaN : sign * value;
}
interface TextValue { toString(): unknown; valueOf(): unknown; }
interface RadixValue { valueOf(): unknown; toString(): unknown; }
interface Parser<S, R> { parse(text: S, radix: R): number; }
function manual(input: string | TextValue, base: number | RadixValue): number {
  let text: unknown = typeof input === "string" ? input : input.toString();
  if (typeof text !== "string" && typeof input !== "string") text = input.valueOf(); if (typeof text !== "string") throw new TypeError();
  let radix: unknown = typeof base === "number" ? base : base.valueOf();
  if (typeof radix !== "number" && typeof base !== "number") radix = base.toString();
  if (typeof radix !== "number") throw new TypeError(); return scan(text, radix);
}
const narrow: Parser<string, number> = { parse: manual }, parser: Parser<string | TextValue, number | RadixValue> = narrow;
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
