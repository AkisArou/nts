// `-0` and `0` are different doubles and the same integer, so a value that might
// be `-0` cannot be represented as one -- unless nothing can tell which it was.
// Working out when that is safe is what `hir::zero_sign` does, and getting it
// wrong is not a crash: it is `+Infinity` where a program said `-Infinity`.
//
// Every function here is a way the sign can escape. `nts check` runs all of them
// against node over a pool that includes both zeros and both signs, which is the
// only reason to believe the analysis.

// Dividing by it is how the sign is seen. `0 * -5` is `-0`, so this is
// `-Infinity` and not `+Infinity`.
export function divideByProduct(a: number, b: number): number {
  return 1 / (a * b);
}

// Negation carries the sign: `-0` is `0` negated.
export function divideByNegation(a: number): number {
  return 1 / -a;
}

// `Math.min(0, -0)` is `-0`, which is the one place min and max are not just
// comparisons.
export function minOfProduct(a: number, b: number): number {
  return Math.min(a * b, 0);
}

// Leaving the function: what the caller does with it is not visible here.
export function returnsProduct(a: number, b: number): number {
  return a * b;
}

// And the case the analysis exists to allow: a coercion carries nothing back,
// so the product may be an integer however many negative zeros it passes
// through.
export function coercedProduct(a: number, b: number): number {
  return (a * b) | 0;
}

// The same question across a loop, where the accumulator is a block parameter
// and the sign has to be carried back along the edge.
export function accumulateThenDivide(n: number, k: number): number {
  // Bounded: the differential sweeps this parameter through a pool holding
  // 2^31, 2^32 and 2^53, which are values worth testing and loop bounds that
  // finish on neither side. See `examples/generators` for the whole reason.
  const bound = n > 65536 ? 65536 : n;
  let total = 0;
  for (let i = 0; i < bound; i++) {
    total = total + i * k;
  }
  return 1 / total;
}

export function accumulateThenCoerce(n: number, k: number): number {
  // Bounded because the differential sweeps this parameter through a pool that
  // contains 2^31, 2^32 and 2^53. Those are useful as *values* and useless as a
  // loop bound: neither node nor the compiled program finishes, both are killed
  // at twenty seconds, and the case is abandoned along with the rest of this
  // function's batch -- scored as neither agreement nor disagreement, so it
  // bought nothing but wall clock, five times over because five backend lanes
  // run the same examples. Clamped, the same case is checked instead.
  const bound = n > 65536 ? 65536 : n;
  let total = 0;
  for (let i = 0; i < bound; i++) {
    total = (total + i * k) | 0;
  }
  return total;
}

// **Underflow is a third way to make one, and the analysis could not see it.**
//
// `-0.1 * 5e-324` is `-0`: neither operand is zero, the product is simply too
// small to represent, and IEEE keeps the sign. Every clause of `facts::mul`'s
// negative-zero rule asked whether an *operand* was or might be zero, so none
// of them fired — and `Facts::new` spells a `-0` bound as `0` deliberately,
// since the two compare equal and an interval means the same thing either way.
// That left the sign nowhere to live: `fold` saw an ordinary singleton zero and
// wrote `0.0` into the program.
//
// `fold`'s own guard was already right — "a singleton at zero that may be
// negative zero is *two* values as far as anything observable goes" — and was
// being handed a fact that had lost the distinction. The fix is upstream of it,
// in the fact.
//
// test262 `language/expressions/multiplication/S11.5.1_A4_T7.js` is this, and
// was one of exactly four files in the 2,527-file slice-1 population that
// compiled, ran, and gave a wrong answer.
//
// # These take no arguments, and that is the whole point
//
// The first version of these arms took `a: number` and multiplied it by the
// denormal — and **agreed on the compiler that had the bug**. The defect is in
// constant folding, so an operand the differential supplies at run time never
// reaches it: the C is computed by the machine, which gets it right. A fixture
// for a folding defect has to be foldable, which here means no parameters.
//
// `underflowThroughAParameter` keeps the runtime path, as the control that says
// the machine was never the problem.

/** Folded: `-0.1 * 5e-324` underflows to `-0`, so this is `-Infinity`. */
export function underflowedProduct(): number {
  return 1 / (-0.1 * 5e-324);
}

/** Folded, both operands negative: the product is `+0`, so `+Infinity`. */
export function underflowedBothNegative(): number {
  return 1 / (-0.1 * -5e-324);
}

/** Folded through a name, which the folder still sees through. */
export function underflowedThroughAName(): number {
  const tiny = 5e-324;
  const scaled = -0.1 * tiny;
  return 1 / scaled;
}

/** The control: the same arithmetic at run time, which was always right. */
export function underflowThroughAParameter(a: number): number {
  return 1 / (a * 5e-324);
}

// # Through an erased slot, which is where `observed` could not see it
//
// A value that is *erased* — handed to an `unknown` parameter, a tagged slot, a
// union — leaves this function's sight. `zero_sign::observed` listed a call
// argument as observed and stopped there, so in
//
//     sign(-0)   where   function sign(a: unknown) { return 1 / (a as number); }
//
// the *erase* was the argument and was observed, while the `neg` behind it was
// not. The lenient test then applied to the one operation that makes a `-0` out
// of a `+0`, the whole chain narrowed to `i32`, and `1 / a` answered
// `+Infinity`. An `Erase` now observes what it erases.
//
// `width_of` was the other half. Its arms for `+ - * %` and for `Neg` asked
// whether the *operands* were integral and never asked about the result — but
// `0 * -5` is `-0` from two operands as integral as values get, and `Neg` is
// the operation that makes one. Both now ask `provable(id)` as well, which
// routes through the same `observed` set and so stays lenient exactly where it
// was lenient before: `examples/arrays`, `strings` and `bitwise` specialise the
// same number of values as they did.
//
// Found through the test262 census, and only after its harness stopped
// comparing with `!==` — `assert.sameValue(x, -0)` was passing for `+0` the
// whole time, so three `test/language` files had been reported as passes.

function sign(a: unknown): number {
  return 1 / (a as number);
}

// **The zeros here are constants, and the first version of these arms was
// wrong for making them parameters.** A parameter is never narrowed to an
// integer by this pass -- there is nothing to narrow it *from* -- so
// `sign(-(a * 0))` agreed on the unfixed compiler, which is the only thing a
// new arm has to fail on. The expected answer is therefore constant and the
// *defect* is what varies: `-Infinity` where the analysis is right, `+Infinity`
// where the sign was lost. `a` is still taken, so the gate compares them.

/** A negated zero through an erased parameter. */
export function negatedThroughAnErasedSlot(a: number): number {
  return sign(-0) + a * 0;
}

/** A product that is `-0`, the same way. */
export function productThroughAnErasedSlot(a: number): number {
  return sign(0 * -5) + a * 0;
}

/** A subtraction that is `-0`: only `-0 - 0` is. */
export function differenceThroughAnErasedSlot(a: number): number {
  return sign(-0 - 0) + a * 0;
}

/** **Control.** A positive zero, which must stay `+Infinity`. */
export function positiveThroughAnErasedSlot(a: number): number {
  return sign(0) + a * 0;
}

/** **Control.** An ordinary integer, which must still specialise and arrive. */
export function integerThroughAnErasedSlot(a: number): number {
  return sign(4) * 100 + (a | 0);
}
