export function add(a: number, b: number): number { return a + b; }
export function sub(a: number, b: number): number { return a - b; }
export function mul(a: number, b: number): number { return a * b; }
export function div(a: number, b: number): number { return a / b; }
export function rem(a: number, b: number): number { return a % b; }
export function lt(a: number, b: number): boolean { return a < b; }
export function gt(a: number, b: number): boolean { return a > b; }
export function cat(a: string, b: string): string { return a + b; }
export function lit(): number { return 40 + 2; }

// `String(x)` is ECMAScript's Number::toString, not a `printf`, and its edges
// are where a library is most likely to disagree with the specification: the
// two infinities, NaN, negative zero -- whose sign is *not* part of the answer
// -- the exponent thresholds at 1e21 and 1e-7, and the largest and smallest
// doubles.
//
// This exists because the implementation changed underneath it. It used to
// find the shortest round-tripping decimal by calling `snprintf("%.*e")` and
// `strtod` at every precision from 1 to 17 until one read back, which is
// correct by verification and cost 1.3us to render `1234567`. quickjs-ng's
// `js_dtoa` computes it instead. Node is the oracle for the swap.
export function numberToStringEdges(n: number): string {
  const zero = n * 0;
  return [
    String(zero),
    String(-zero),
    String(1 / zero),
    String(-1 / zero),
    String(zero / zero),
    String(1e20 + zero),
    String(1e21 + zero),
    String(1e-6 + zero),
    String(1e-7 + zero),
    String(5e-324 + zero),
    String(1.7976931348623157e308 + zero),
    String(0.1 + 0.2 + zero),
    String(123456789012345678901234567890 + zero),
    String(-0.000001 + zero),
    String(n),
    String(1 / n),
  ].join("|");
}
