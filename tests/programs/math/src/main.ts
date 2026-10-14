// The `Math` functions that are a call rather than an operation, and the
// exponentiation operator that spells one of them.
//
// None of these is a candidate for integer specialization -- a logarithm of an
// integer is not an integer -- so each lowers to a call into the runtime rather
// than to an IR operation. That is the whole reason they were cheap to add: no
// pass had to learn a new opcode.
//
// Two of them are not their C namesakes, and this file exists mostly to hold
// those two against node.

// `**` is *not* C's `pow`. ECMAScript says a base of 1 or -1 with an infinite
// exponent is NaN; C99 says both are 1, on the grounds that the limit is 1.
// The difference is reachable from ordinary source, because an exponent can
// overflow to infinity without anyone writing `Infinity`.
export function power(base: number, exponent: number): number {
  return base ** exponent;
}

// The rule above, reached the way a program reaches it. Nothing here writes
// `Infinity`: `exponent * 1e308` overflows to one for any exponent past about
// 1.8, and to the negative one below about -1.8. With a base of 1 or -1 this is
// the case where C says 1 and JavaScript says NaN.
//
// Written because dropping the rule from the runtime did not fail anything --
// the driver's pool holds 1 and -1 but no infinity, so the special case the
// helper exists for was never being executed. A rule with no case that reaches
// it is a rule that is not tested.
export function overflowingExponent(base: number, exponent: number): number {
  return base ** (exponent * 1e308);
}

// **The second divergence, and the same one twice.** `Number::exponentiate`
// step 1 is "if exponent is NaN, return NaN", *before* it says anything about
// the base. C99 F.10.4.4 says `pow(+1, y)` returns 1 for any y, **even a NaN**,
// and Java's `Math.pow` says the same -- so `1 ** NaN` answered 1 where node
// answers NaN.
//
// Reached rather than written, for the reason the comment above gives about
// infinity: `Math.sqrt` of a negative is NaN, and `-1 - |exponent|` is negative
// whatever the pool hands over.
//
// **The exponent is NaN for every input, deliberately, and the first version of
// this arm was wrong for wanting otherwise.** `base ** Math.sqrt(exponent)`
// looks like the better fixture -- some inputs NaN, some not -- and it passed on
// the *pre-fix* compiler, which is the only thing that makes a new arm worth
// having. The driver pairs its arguments rather than crossing them, so a base of
// 1 was never handed a negative exponent and the case the rule exists for was
// never executed. The same trap the infinity comment above describes, one pool
// dimension over.
//
// The answer here is NaN for every base, which is what a working compiler
// makes it; the *defect* is what varies, answering 1 at base 1 and NaN
// everywhere else. A constant expected answer is a weak check in general and
// the right one here.
export function aNaNExponent(base: number, exponent: number): number {
  return base ** Math.sqrt(-1 - Math.abs(exponent));
}

// The same, through `Math.pow`, because the two spellings are one helper and a
// rule fixed in one of them would otherwise be a rule fixed in one of them.
export function aNaNExponentCall(base: number, exponent: number): number {
  return Math.pow(base, Math.sqrt(-1 - Math.abs(exponent)));
}

// **Control.** `x ** 0` is 1 for every base, NaN included, which the
// specification says before it says anything else about the base -- and which
// the exponent-is-NaN rule above must not have broken, since zero is not a NaN.
export function aZeroExponent(base: number): number {
  return base ** 0;
}

// The same operation under its other two spellings.
export function powerCall(base: number, exponent: number): number {
  return Math.pow(base, exponent);
}

export function compound(base: number, exponent: number): number {
  let x = base;
  x **= exponent;
  return x;
}

// `Math.sign` has no libm equivalent, and is not `copysign` either: zero keeps
// its sign, NaN stays NaN, and everything else collapses to +/-1.
export function sign(x: number): number {
  return Math.sign(x);
}

// The nearest `float`, back as a `double`.
export function fround(x: number): number {
  return Math.fround(x);
}

// The straight forwards. Each is checked against node rather than assumed to
// match libm -- which is what caught the two above.
export function logs(x: number): number {
  return Math.log(x) + Math.log2(x) + Math.log10(x) + Math.log1p(x);
}

export function exponentials(x: number): number {
  return Math.exp(x) + Math.expm1(x) + Math.cbrt(x);
}

export function trig(x: number): number {
  return Math.sin(x) + Math.cos(x) + Math.tan(x);
}

export function inverseTrig(x: number): number {
  return Math.asin(x) + Math.acos(x) + Math.atan(x);
}

export function hyperbolic(x: number): number {
  return Math.sinh(x) + Math.cosh(x) + Math.tanh(x);
}

export function angle(y: number, x: number): number {
  return Math.atan2(y, x);
}

export function hypotenuse(a: number, b: number): number {
  return Math.hypot(a, b);
}

// The named constants. Each is the `double` nearest a mathematical constant,
// and the compiler emits the same bits node holds -- checked, not assumed.
export function constants(x: number): number {
  const trigonometry = Math.PI * x + Math.E;
  const logarithms = Math.LN2 + Math.LN10 + Math.LOG2E + Math.LOG10E;
  const roots = Math.SQRT2 + Math.SQRT1_2;
  return trigonometry + logarithms + roots;
}

// The exponents that fold. `nts_math_pow` is in the runtime's translation unit,
// so the C compiler cannot see through it the way it sees through `pow` --
// `d ** 2` would cost a call where the C++ this is measured against costs a
// multiply. Only the exponents that are *exactly* the shorter form fold: 0, 1
// and 2. `** 3` and `** -1` were measured against node and are not, for reasons
// the lowering records.
export function inverseSquare(distance: number): number {
  return 1 / distance ** 2;
}

export function folds(x: number): number {
  return x ** 0 + x ** 1 * 10 + x ** 2 * 100;
}

// The exponents that do not fold, which have to stay a call and agree anyway.
export function unfolded(x: number): number {
  return x ** 3 + x ** -1;
}
