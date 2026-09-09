// expect: `parseFloat`, a builtin this compiler does not provide
//
// Three number-facing builtins that are not provided, and one string method
// that is provided with fewer arguments than it has.
//
// **`parseInt` is provided now** and the expectation moved to the next name in
// the file, which is what this fixture was shaped for: four things behind one
// expectation, so a fix that lands one and not the others still reports the
// fixture as reproducing rather than as closed. It did exactly that.
//
// `parseInt` was the largest of the four -- 14 sites across 6 modules, with
// `os.networkInterfaces` behind it through `getCIDR` -- and it is `nts_parse_int`
// now, agreeing with node on 278 of 279 cases over thirty-one strings and nine
// radixes. `examples/parse-int` carries the behaviour; the one divergence is a
// last-bit rounding past 2^53 in a radix that is not a power of two, and it is
// named in the runtime header rather than hidden.
//
//     parseInt("12abc", 10)      `parseInt`, a builtin this compiler does not provide
//     parseFloat("1e3")          `parseFloat`, the same
//     (1.005).toFixed(2)         `toFixed` on a number
//     "a,b,c".split(",", 2)      a string method with this many arguments
//
// # Reach, counted rather than guessed
//
//     parseInt     14 call sites across 6 modules of runtime/node
//     toFixed       3 call sites in 1
//     parseFloat    1 call site in 1
//     split with a limit   5 call sites
//
// `parseInt` is the one that matters: six modules is a wide enough spread that
// it will be in front of something in most of them, and it is the same shape as
// `decodeURIComponent` in `missing-builtin` -- closed by writing it, not by
// deciding anything.
//
// # How they were found, and what agreed around them
//
// By a sweep of fourteen string and number questions in
// `agreements/string-and-number-method-seams`, not by looking for them. The
// eight that were **not** refused all agree with node exactly: `parseInt`
// stopping at a non-digit is refused, but `padStart` padding to a total length,
// `repeat` with a count of zero, `split` with an empty separator, `indexOf` and
// `lastIndexOf` of an empty string, `slice` clamping rather than throwing,
// `charAt` past the end, `Number` of a whitespace-only string being zero, and
// `"ß".toUpperCase()` having two characters are all exact.
//
// That is the useful shape of it: the string surface that exists is right, and
// what is missing is missing rather than wrong.
//
// The expectation names `parseInt` because it is the widest of the four. The
// other three are in the file so a fix that lands one and not the others is
// visible as this fixture still reproducing.

export function parseAnInteger(text: string): number {
  return parseInt(text, 10);
}

export function parseAFloat(text: string): number {
  return parseFloat(text);
}

export function twoDecimalPlaces(value: number): number {
  return value.toFixed(2).length;
}

export function splitWithALimit(text: string): number {
  return text.split(",", 2).length;
}
