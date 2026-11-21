// `s.split(undefined)` is `[s]` (ECMA-262 `String.prototype.split`, step 9),
// and a zero limit still keeps nothing (step 8).
//
// Reduced from test262 `built-ins/String/prototype/split/separator-undef.js`,
// which crashed on LLVM (#932). The separator reached `nts_str_split`, which
// takes `const NtsString *`, unchecked: `s.split()` padded it with a number and
// `s.split(undefined)` passed an erased value. C refused to compile the call.
// LLVM compiled it, and the helper read whatever pointer was left in the
// register. No commit introduced the crash: the emitted IR for both calls is
// byte-identical at ca63c805525a, where the stale pointer happened to be
// readable and the test failed on a wrong length, and at 539ea74baf, where it
// segfaulted. Bisection only found unrelated layout changes that moved which
// value sat there. The LLVM emitter's missing check of helper arguments
// against their declared signatures is #944.
//
// `undefined!` is how TypeScript spells the undefined separator: the library
// types `split` with a required `string | RegExp`. The control arms differ
// only in the separator, a string, and agree with node on every compiler.
//
// The same check now refuses any argument that is not a string at a string
// position, so a constant `null` or `undefined` there is lowered to the
// string its `ToString` makes ("null", "undefined", or a pad's default fill)
// rather than refused. test262's `concat(null)`, `concat(undefined)` and
// `concat(void 0)` (S15.5.4.6_A1_T5, T7, T8) are that shape. Their control
// passes the same text as string literals.

const text = "undefined is not a function";

/** The whole string, once. Crashes on LLVM before the fix. */
export function whole(n: number): number {
  const parts = text.split(undefined!);
  return parts.length * 10 + (parts[0] === text ? 1 : 0) + n;
}

/** A zero limit is checked before the separator: nothing at all. */
export function zeroLimit(n: number): number {
  return text.split(undefined!, 0).length + n;
}

/** A computed limit, so the differential's inputs (negative, fractional,
 *  large) reach the truncation of `[s]`. */
export function computedLimit(n: number): number {
  return text.split(undefined!, n).length;
}

/** The answer is a fresh array the program may grow. */
export function grown(n: number): string {
  const parts = text.split(undefined!);
  parts.push(String(n));
  return parts.join("|");
}

/** Control: a string separator, the same receiver. */
export function control(n: number): number {
  const parts = text.split(" ");
  return parts.length * 10 + (parts[0] === "undefined" ? 1 : 0) + n;
}

/** Control: a string separator with the same computed limit. */
export function controlLimit(n: number): number {
  return text.split(" ", n).length;
}

/** A constant `null` and `undefined` concatenated: their `ToString`. */
export function concatAbsent(n: number): string {
  return text.concat(null!, undefined!, String(n));
}

/** Control: the same text, as strings. */
export function concatAbsentControl(n: number): string {
  return text.concat("null", "undefined", String(n));
}

/** An `undefined` fill is absent, a single space; a `null` one is "null". */
export function padAbsentFill(n: number): string {
  return "ab".padStart(5, undefined!) + "|" + "ab".padEnd(5, null!) + n;
}

/** A `null` separator and pattern are the text "null". */
export function nullSeparator(n: number): string {
  return "anullb".split(null!).join("+") + "anullb".replace(null!, String(n));
}

const parts = text.split(undefined!);
console.log(parts.length, parts[0] === text, text.split(undefined!, 0).length);
console.log(text.split(" ").length);
