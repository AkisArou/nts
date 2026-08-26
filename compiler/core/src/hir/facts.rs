//! What is provably true about a `number` at a program point.
//!
//! # Why this exists
//!
//! [`HirType::NUMBER`](super::HirType::NUMBER) is `f64` because that is what
//! TypeScript's `number` conservatively is. `benches/` prices that conservatism:
//! hand-written C using `int64` runs the same `fib` **1.7x faster** than the
//! same C in doubles, and V8 already performs the inference we do not — on the
//! `loop` case node matches integer C while nts sits with double C. See
//! `docs/records/0004-codegen-is-at-c-parity.md`.
//!
//! Closing that gap means proving a value is an integer. Not guessing: a wrong
//! answer here silently changes what a program computes.
//!
//! # What is being learned from, and what is not
//!
//! The proof-of-compiler's `number-facts.ts` solved the hard half of this, and
//! the hard half is *not* the dataflow — it is knowing that `0 * Infinity` is
//! NaN, that remainder takes the sign of its dividend, that `x | 0` is a proof
//! by way of `ToInt32`, and that `-0` is observably distinct from `0`. Those
//! transfer functions are JavaScript semantics, they were expensive to get
//! right, and they are reproduced here in that spirit.
//!
//! The *driver* is deliberately not reproduced. `number-facts.ts` threads an
//! environment keyed by variable name through a tree-shaped IR, because that IR
//! has no SSA form and no explicit joins. Ours does: a value has exactly one
//! definition, joins happen at block parameters, and the incoming values are
//! written on the edge. Reproducing an environment-threading walk on top of that
//! would be re-solving a problem the representation already solved.
//!
//! # The three obligations
//!
//! A `number` may cross into an integer slot only if all three hold, and the
//! order matters when reporting *why* not:
//!
//! 1. **Representability** — the literal the author wrote survives `f64`.
//! 2. **Wholeness** — integral on every path, NaN excluded.
//! 3. **Range** — within ±(2^53 − 1), beyond which integrality is not provable
//!    at all, because adjacent integers stop being distinguishable as doubles.

// Exact float comparison is this module's whole job. `lo == hi` asks whether an
// interval is a single value; `value == 0.0` asks whether a value is a zero.
// Comparing either within a tolerance would answer a question nobody asked and
// would make the analysis unsound in both directions.
#![allow(clippy::float_cmp)]

/// `Number.MAX_SAFE_INTEGER`. Past this, consecutive integers are not
/// distinguishable as `f64`, so "this value is that integer" stops being a
/// claim anything could verify.
pub const SAFE_MAX: f64 = 9_007_199_254_740_991.0;
/// `Number.MIN_SAFE_INTEGER`.
pub const SAFE_MIN: f64 = -SAFE_MAX;

/// The set of `f64` values one value may hold.
///
/// A closed interval over the extended reals, plus the facts an interval cannot
/// express. NaN lives *outside* the interval — it is unordered, so it has no
/// place in one — which is why it needs its own flag rather than a bound.
///
/// `-0` is likewise not an interval fact: it compares equal to `0` and orders
/// with it, so no pair of bounds distinguishes them. It still has to be tracked,
/// because `1/-0` is `-Infinity` and `1/0` is `+Infinity`, and because storing a
/// `-0` into an integer slot loses a distinction the program could observe.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Facts {
    /// Lower bound, inclusive. Never NaN.
    pub lo: f64,
    /// Upper bound, inclusive. Never NaN.
    pub hi: f64,
    /// Every numeric member is a finite integer-valued `f64`.
    pub whole: bool,
    /// NaN may be a member.
    pub maybe_nan: bool,
    /// The observably distinct value `-0` may be a member.
    pub maybe_negative_zero: bool,
}

impl Facts {
    /// Anything at all: what an unanalyzed parameter or an opaque call returns.
    pub const TOP: Self = Self {
        lo: f64::NEG_INFINITY,
        hi: f64::INFINITY,
        whole: false,
        maybe_nan: true,
        maybe_negative_zero: true,
    };

    /// The empty set — no value reaches here.
    ///
    /// Spelled with crossed bounds so that [`Self::join`] with anything is that
    /// thing, which is what makes an unreachable predecessor contribute nothing.
    pub const BOTTOM: Self = Self {
        lo: f64::INFINITY,
        hi: f64::NEG_INFINITY,
        whole: true,
        maybe_nan: false,
        maybe_negative_zero: false,
    };

    /// Build a set, restoring the invariants the fields cannot enforce.
    #[must_use]
    pub fn new(lo: f64, hi: f64, whole: bool, maybe_nan: bool, maybe_negative_zero: bool) -> Self {
        // A NaN bound is not an ordering, so it cannot describe an interval. It
        // arises where an operation on the endpoints is itself NaN — `Infinity +
        // -Infinity`, say — and the widest bound is the only sound reading. The
        // caller is responsible for having set `maybe_nan`; this only keeps the
        // *interval* meaningful.
        let lo = if lo.is_nan() { f64::NEG_INFINITY } else { lo };
        let hi = if hi.is_nan() { f64::INFINITY } else { hi };

        // A bound of `-0` would compare equal to `0` but format differently and
        // hash differently; the interval means the same thing either way, so it
        // is spelled one way.
        let lo = if lo == 0.0 { 0.0 } else { lo };
        let hi = if hi == 0.0 { 0.0 } else { hi };
        Self {
            lo,
            hi,
            // An infinity is not an integer. A set that may contain one cannot
            // claim every member is whole.
            whole: whole && lo.is_finite() && hi.is_finite(),
            maybe_nan,
            // `-0` is only possible if the interval straddles zero, since `-0`
            // compares equal to `0`.
            maybe_negative_zero: maybe_negative_zero && lo <= 0.0 && hi >= 0.0,
        }
    }

    /// Exactly one value.
    #[must_use]
    pub fn constant(value: f64) -> Self {
        if value.is_nan() {
            return Self {
                maybe_nan: true,
                ..Self::BOTTOM
            };
        }
        Self::new(
            value,
            value,
            value.fract() == 0.0 && value.is_finite(),
            false,
            value.is_sign_negative() && value == 0.0,
        )
    }

    /// No value reaches here.
    #[must_use]
    pub fn is_bottom(&self) -> bool {
        self.lo > self.hi && !self.maybe_nan
    }

    /// Exactly one numeric value, and not NaN.
    #[must_use]
    pub fn is_singleton(&self) -> bool {
        self.lo == self.hi && !self.maybe_nan
    }

    /// Whether the interval has any members at all. Distinct from
    /// [`Self::is_bottom`]: a set may be numerically empty but still hold NaN.
    #[must_use]
    fn has_numeric(&self) -> bool {
        self.lo <= self.hi
    }

    /// Least upper bound: what is true after two paths meet.
    #[must_use]
    pub fn join(self, other: Self) -> Self {
        if self.is_bottom() {
            return other;
        }
        if other.is_bottom() {
            return self;
        }
        let (a, b) = (self, other);
        let (lo, hi) = match (a.has_numeric(), b.has_numeric()) {
            // A side with no numeric members contributes no bounds.
            (true, false) => (a.lo, a.hi),
            (false, true) => (b.lo, b.hi),
            // Both have members, or neither does. The hull is correct either
            // way: two crossed intervals hull to a crossed interval.
            _ => (a.lo.min(b.lo), a.hi.max(b.hi)),
        };
        Self::new(
            lo,
            hi,
            // A side with no numeric members makes no claim about wholeness,
            // so it cannot refute the other side's.
            (!a.has_numeric() || a.whole) && (!b.has_numeric() || b.whole),
            a.maybe_nan || b.maybe_nan,
            a.maybe_negative_zero || b.maybe_negative_zero,
        )
    }

    /// Whether a concrete value could be a member.
    ///
    /// The concretization relation, and the thing every transfer function is
    /// tested against: the abstract result must contain every value the real
    /// operation could actually produce.
    #[must_use]
    pub fn contains(&self, value: f64) -> bool {
        if value.is_nan() {
            return self.maybe_nan;
        }
        // `-0` is a member only if it is claimed, even though the interval
        // cannot tell it from `0`. This is the whole reason the flag exists.
        if value == 0.0 && value.is_sign_negative() && !self.maybe_negative_zero {
            return false;
        }
        if self.whole && !(value.fract() == 0.0 && value.is_finite()) {
            return false;
        }
        self.lo <= value && value <= self.hi
    }

    /// The intersection: what is true if *both* are true.
    ///
    /// The dual of [`Self::join`], and used where two independent sources
    /// constrain one value — a parameter bounded both by its declared type and
    /// by every argument any caller passes. Either may prove wholeness; only
    /// their agreement admits NaN.
    #[must_use]
    pub fn narrow(self, other: Self) -> Self {
        if self.is_bottom() || other.is_bottom() {
            return Self::BOTTOM;
        }
        Self::new(
            self.lo.max(other.lo),
            self.hi.min(other.hi),
            self.whole || other.whole,
            self.maybe_nan && other.maybe_nan,
            self.maybe_negative_zero && other.maybe_negative_zero,
        )
    }

    /// Whether every member of `self` is also a member of `other`.
    ///
    /// The soundness relation. Used by the tests to state the property that
    /// matters — a transfer function's result must contain every value the real
    /// operation could produce — rather than pinning the exact intervals, which
    /// would make any precision improvement look like a regression.
    #[must_use]
    pub fn subsumes(&self, other: Self) -> bool {
        if other.is_bottom() {
            return true;
        }
        if other.maybe_nan && !self.maybe_nan {
            return false;
        }
        if other.maybe_negative_zero && !self.maybe_negative_zero {
            return false;
        }
        if self.whole && !other.whole && other.has_numeric() {
            return false;
        }
        !other.has_numeric() || (self.lo <= other.lo && self.hi >= other.hi)
    }
}

/// Bounds a widening step will jump to.
///
/// A loop counter's upper bound grows by one per analysis round, and analyzing
/// a million-iteration loop a million times is not an option. Widening jumps a
/// still-growing bound straight to the next threshold instead.
///
/// The thresholds are exactly the points where a verdict could change — the
/// `i32` boundary, the `u32` boundary, the safe-integer boundary — so precision
/// is given up only where it had stopped buying anything.
const WIDEN_UP: [f64; 5] = [
    0.0,
    2_147_483_647.0,
    4_294_967_295.0,
    SAFE_MAX,
    f64::INFINITY,
];
const WIDEN_DOWN: [f64; 4] = [0.0, -2_147_483_648.0, SAFE_MIN, f64::NEG_INFINITY];

/// Force convergence when a bound keeps growing between rounds.
///
/// Applied only at a loop header, and only after the header has been revisited
/// enough times to show the bound is not going to settle on its own.
#[must_use]
pub fn widen(prev: Facts, next: Facts) -> Facts {
    if prev.is_bottom() {
        return next;
    }
    let lo = if next.lo < prev.lo {
        WIDEN_DOWN
            .into_iter()
            .find(|t| *t <= next.lo)
            .unwrap_or(f64::NEG_INFINITY)
    } else {
        next.lo
    };
    let hi = if next.hi > prev.hi {
        WIDEN_UP
            .into_iter()
            .find(|t| *t >= next.hi)
            .unwrap_or(f64::INFINITY)
    } else {
        next.hi
    };
    Facts::new(lo, hi, next.whole, next.maybe_nan, next.maybe_negative_zero)
}

/// Endpoint product, for bound purposes only.
///
/// `0 * Infinity` is NaN, but as an *interval bound* the correct limit is 0 —
/// the NaN is [`Facts::maybe_nan`]'s business, and letting it become a bound
/// would poison the interval with a value that has no ordering.
fn bound_mul(a: f64, b: f64) -> f64 {
    if a == 0.0 || b == 0.0 { 0.0 } else { a * b }
}

/// The four endpoint products, since a sign change reorders them.
fn corners(a: Facts, b: Facts, f: impl Fn(f64, f64) -> f64) -> (f64, f64) {
    let products = [f(a.lo, b.lo), f(a.lo, b.hi), f(a.hi, b.lo), f(a.hi, b.hi)];
    products
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            (lo.min(*p), hi.max(*p))
        })
}

/// Only NaN survives an operation on a set with no numeric members.
fn empty_but_nan(maybe_nan: bool) -> Facts {
    Facts {
        maybe_nan,
        ..Facts::BOTTOM
    }
}

#[must_use]
pub fn add(a: Facts, b: Facts) -> Facts {
    let mut maybe_nan = a.maybe_nan || b.maybe_nan;
    if !a.has_numeric() || !b.has_numeric() {
        return empty_but_nan(maybe_nan);
    }
    // `Infinity + -Infinity` is NaN, reachable when opposite infinities meet.
    if (a.hi.is_infinite() && a.hi > 0.0 && b.lo.is_infinite() && b.lo < 0.0)
        || (a.lo.is_infinite() && a.lo < 0.0 && b.hi.is_infinite() && b.hi > 0.0)
    {
        maybe_nan = true;
    }
    Facts::new(
        a.lo + b.lo,
        a.hi + b.hi,
        a.whole && b.whole,
        maybe_nan,
        // `x + y` is `-0` only when both addends are; `-0 + 0` is `+0`.
        a.maybe_negative_zero && b.maybe_negative_zero,
    )
}

#[must_use]
pub fn sub(a: Facts, b: Facts) -> Facts {
    let mut maybe_nan = a.maybe_nan || b.maybe_nan;
    if !a.has_numeric() || !b.has_numeric() {
        return empty_but_nan(maybe_nan);
    }
    // `Infinity - Infinity` is NaN.
    if (a.hi == f64::INFINITY && b.hi == f64::INFINITY)
        || (a.lo == f64::NEG_INFINITY && b.lo == f64::NEG_INFINITY)
    {
        maybe_nan = true;
    }
    Facts::new(
        a.lo - b.hi,
        a.hi - b.lo,
        a.whole && b.whole,
        maybe_nan,
        // `-0 - 0` is `-0`; `0 - 0` is `+0`.
        a.maybe_negative_zero && b.lo <= 0.0 && b.hi >= 0.0,
    )
}

#[must_use]
pub fn mul(a: Facts, b: Facts) -> Facts {
    let mut maybe_nan = a.maybe_nan || b.maybe_nan;
    if !a.has_numeric() || !b.has_numeric() {
        return empty_but_nan(maybe_nan);
    }
    let a_has_zero = a.lo <= 0.0 && a.hi >= 0.0;
    let b_has_zero = b.lo <= 0.0 && b.hi >= 0.0;
    let a_infinite = a.lo.is_infinite() || a.hi.is_infinite();
    let b_infinite = b.lo.is_infinite() || b.hi.is_infinite();
    // `0 * Infinity` is NaN.
    if (a_has_zero && b_infinite) || (b_has_zero && a_infinite) {
        maybe_nan = true;
    }
    let (lo, hi) = corners(a, b, bound_mul);

    // IEEE gives a product the exclusive-or of its operands' signs, so a zero
    // product is `-0` exactly when the two signs differ. Stating it that way
    // rather than enumerating cases is what makes `(-0) * 0` come out right:
    // it is `-0`, even though neither operand is negative in the ordering sense
    // and neither interval reaches below zero.
    let a_negative = a.lo < 0.0 || a.maybe_negative_zero;
    let b_negative = b.lo < 0.0 || b.maybe_negative_zero;
    let a_positive = a.hi > 0.0 || a_has_zero;
    let b_positive = b.hi > 0.0 || b_has_zero;

    Facts::new(
        lo,
        hi,
        a.whole && b.whole,
        maybe_nan,
        (a_has_zero && b_negative)
            || (a.maybe_negative_zero && b_positive)
            || (b_has_zero && a_negative)
            || (b.maybe_negative_zero && a_positive),
    )
}

#[must_use]
pub fn div(a: Facts, b: Facts) -> Facts {
    // `Infinity / Infinity` is NaN, in every sign combination. An interval
    // domain misses this: neither operand is near zero and neither bound looks
    // suspicious, so the quotient appears to be an ordinary number.
    let both_infinite =
        (a.lo.is_infinite() || a.hi.is_infinite()) && (b.lo.is_infinite() || b.hi.is_infinite());
    let maybe_nan = a.maybe_nan || b.maybe_nan || both_infinite;
    if !a.has_numeric() || !b.has_numeric() {
        return empty_but_nan(maybe_nan);
    }
    // Division by exactly zero: `x/0` is a signed infinity, `0/0` is NaN.
    // TypeScript has no integer division, so this is not an error to report —
    // it is a value the program will hold.
    if b.is_singleton() && b.lo == 0.0 {
        // `0 / 0` is NaN; any other dividend gives a signed infinity, and the
        // sign is the exclusive-or of both operands' signs. Taking it from the
        // dividend alone gets `-1 / -0` backwards: that is `+Infinity`.
        //
        // A zero divisor that may be `-0` may also be `+0` — the interval is
        // `[0, 0]` either way, and nothing in this domain can rule the other
        // one out — so both signs stay reachable.
        let nan_possible = maybe_nan || (a.lo <= 0.0 && a.hi >= 0.0);
        let minus_zero_divisor = b.maybe_negative_zero;
        let positive_dividend = a.hi > 0.0;
        let negative_dividend = a.lo < 0.0;

        let may_be_positive = positive_dividend || (negative_dividend && minus_zero_divisor);
        let may_be_negative = negative_dividend || (positive_dividend && minus_zero_divisor);

        return match (may_be_negative, may_be_positive) {
            (true, true) => {
                Facts::new(f64::NEG_INFINITY, f64::INFINITY, false, nan_possible, false)
            }
            (true, false) => Facts::new(
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
                false,
                nan_possible,
                false,
            ),
            (false, true) => Facts::new(f64::INFINITY, f64::INFINITY, false, nan_possible, false),
            // The dividend is exactly zero, so the quotient is only ever NaN.
            (false, false) => empty_but_nan(nan_possible),
        };
    }
    // A divisor straddling zero makes the quotient unbounded in both directions.
    if b.lo <= 0.0 && b.hi >= 0.0 {
        return Facts::TOP;
    }
    let (lo, hi) = corners(a, b, |x, y| x / y);

    // A quotient is `-0` only when it is a zero *and* the two signs differ —
    // the same exclusive-or rule as multiplication. Claiming it whenever the
    // result straddles zero is sound but costly: it refuses every non-negative
    // division, and a `-0` is enough to refuse an integer representation, so
    // `Math.floor(bounded / 65536)` stopped being provable for no reason.
    let a_negative = a.lo < 0.0 || a.maybe_negative_zero;
    let b_negative = b.lo < 0.0 || b.maybe_negative_zero;
    let a_positive = a.hi > 0.0 || (a.lo <= 0.0 && a.hi >= 0.0);
    let b_positive = b.hi > 0.0 || (b.lo <= 0.0 && b.hi >= 0.0);
    let may_be_zero = lo <= 0.0 && hi >= 0.0;
    let negative_zero = may_be_zero && ((a_negative && b_positive) || (a_positive && b_negative));

    Facts::new(
        lo,
        hi,
        // Division does not preserve wholeness: `7 / 2` is `3.5`. The only case
        // provable without folding is a singleton that lands on an integer.
        lo == hi && lo.fract() == 0.0 && lo.is_finite(),
        maybe_nan,
        negative_zero,
    )
}

#[must_use]
pub fn rem(a: Facts, b: Facts) -> Facts {
    let mut maybe_nan = a.maybe_nan || b.maybe_nan;
    if !a.has_numeric() || !b.has_numeric() {
        return empty_but_nan(maybe_nan);
    }
    // `x % 0` is NaN, and so is `Infinity % y`.
    if b.lo <= 0.0 && b.hi >= 0.0 {
        maybe_nan = true;
    }
    if a.lo.is_infinite() || a.hi.is_infinite() {
        maybe_nan = true;
    }
    if a.is_singleton() && b.is_singleton() && !maybe_nan {
        let exact = Facts::constant(a.lo % b.lo);
        // `a.lo` is the *interval* bound, and the interval normalized `-0` to
        // `0` — it cannot tell the zeroes apart, which is what the flag is for.
        // Since the remainder takes the dividend's sign, a `-0` dividend gives a
        // `-0` result. `Facts::new` drops the flag again if the result is not a
        // zero at all, so this cannot over-claim.
        return Facts::new(
            exact.lo,
            exact.hi,
            exact.whole,
            false,
            exact.maybe_negative_zero || a.maybe_negative_zero,
        );
    }
    // JavaScript's remainder takes the sign of the **dividend**, not the
    // divisor — `-7 % 3` is `-1`, where a mathematician would say `2`. The
    // magnitude is strictly less than the divisor's.
    let divisor_max = b.lo.abs().max(b.hi.abs());
    let bound = if a.whole && b.whole && divisor_max.is_finite() {
        divisor_max - 1.0
    } else {
        divisor_max
    };
    Facts::new(
        if a.lo < 0.0 { -bound } else { 0.0 },
        if a.hi > 0.0 { bound } else { 0.0 },
        a.whole && b.whole,
        maybe_nan,
        a.maybe_negative_zero || a.lo < 0.0,
    )
}

#[must_use]
pub fn neg(a: Facts) -> Facts {
    if !a.has_numeric() {
        return empty_but_nan(a.maybe_nan);
    }
    Facts::new(
        -a.hi,
        -a.lo,
        a.whole,
        a.maybe_nan,
        // Negating a zero produces the other zero, so a set containing either
        // zero may produce `-0`.
        a.lo <= 0.0 && a.hi >= 0.0,
    )
}

/// The int32 range, which every bitwise operator's result lives in.
pub const I32_MIN: f64 = -2_147_483_648.0;
pub const I32_MAX: f64 = 2_147_483_647.0;
/// The uint32 range, which `>>>` alone can reach.
pub const U32_MAX: f64 = 4_294_967_295.0;

/// JavaScript's `ToInt32`.
///
/// Total, unlike a C cast: NaN and both infinities map to `0`, and everything
/// else truncates toward zero and wraps modulo 2^32. The result is therefore
/// *always* a whole number inside int32 — which is the entire reason `x | 0` is
/// how integer intent is written in JavaScript. It is a proof, not a hint.
#[must_use]
pub fn to_int32(a: Facts) -> Facts {
    // Already an int32: the coercion is the identity, and saying so keeps the
    // range the caller worked for instead of widening back to the full int32.
    if a.has_numeric() && !a.maybe_nan && a.whole && a.lo >= I32_MIN && a.hi <= I32_MAX {
        return Facts::new(a.lo, a.hi, true, false, false);
    }
    // Only NaN reaches here, and `ToInt32(NaN)` is `0`.
    if !a.has_numeric() {
        return Facts::constant(0.0);
    }
    Facts::new(I32_MIN, I32_MAX, true, false, false)
}

/// JavaScript's `ToUint32`.
#[must_use]
pub fn to_uint32(a: Facts) -> Facts {
    if a.has_numeric() && !a.maybe_nan && a.whole && a.lo >= 0.0 && a.hi <= U32_MAX {
        return Facts::new(a.lo, a.hi, true, false, false);
    }
    if !a.has_numeric() {
        return Facts::constant(0.0);
    }
    Facts::new(0.0, U32_MAX, true, false, false)
}

/// The exact value of a set that holds exactly one whole number.
fn exact(v: Facts) -> Option<i32> {
    if !v.is_singleton() || !v.whole || v.lo < I32_MIN || v.lo > I32_MAX {
        return None;
    }
    #[allow(clippy::cast_possible_truncation)]
    Some(v.lo as i32)
}

/// Bitwise operators, on operands already coerced.
///
/// The result is whole and int32-ranged whatever the inputs were — `>>>` alone
/// reaches uint32. That guarantee is the useful part; the folding below is only
/// precision on top of it.
#[must_use]
pub fn bitwise(op: super::BinOp, a: Facts, b: Facts) -> Facts {
    use super::BinOp;

    if let (Some(x), Some(y)) = (exact(a), exact(b)) {
        // JavaScript masks a shift count to five bits, so `1 << 32` is `1`, not
        // zero and not undefined behaviour.
        #[allow(clippy::cast_sign_loss)]
        let count = (y as u32) & 31;
        let folded = match op {
            BinOp::BitAnd => f64::from(x & y),
            BinOp::BitOr => f64::from(x | y),
            BinOp::BitXor => f64::from(x ^ y),
            BinOp::Shl => f64::from(x.wrapping_shl(count)),
            BinOp::Shr => f64::from(x.wrapping_shr(count)),
            #[allow(clippy::cast_sign_loss)]
            BinOp::UShr => f64::from((x as u32).wrapping_shr(count)),
            _ => return Facts::TOP,
        };
        return Facts::constant(folded);
    }

    // Masking with a known non-negative int32 cannot set a bit outside the mask,
    // so the result is in `[0, mask]` regardless of the other operand. This is a
    // materially tighter range than the generic int32 one, and it is the
    // ordinary spelling of a bounded index: `hash & 1023`.
    if matches!(op, BinOp::BitAnd)
        && let Some(mask) = exact(a).or_else(|| exact(b))
        && mask >= 0
    {
        return Facts::new(0.0, f64::from(mask), true, false, false);
    }

    // A logical right shift by a known non-zero amount bounds the result from
    // above: shifting a uint32 right by `n` leaves at most `32 - n` bits.
    if matches!(op, BinOp::UShr)
        && let Some(count) = exact(b)
        && (count & 31) > 0
    {
        #[allow(clippy::cast_sign_loss)]
        let bits = 32 - ((count as u32) & 31);
        return Facts::new(0.0, f64::from(u32::MAX >> (32 - bits)), true, false, false);
    }

    if matches!(op, BinOp::UShr) {
        return Facts::new(0.0, U32_MAX, true, false, false);
    }
    Facts::new(I32_MIN, I32_MAX, true, false, false)
}

/// `Math.floor`, `Math.ceil`, `Math.trunc`, `Math.round`.
///
/// The point of these is the wholeness they establish: whatever came in, what
/// comes out is an integer. That is the same kind of fact `ToInt32` gives, and
/// a more useful one, because it keeps the magnitude rather than wrapping it —
/// which is how an author states integer intent about a value larger than
/// int32.
///
/// The bounds move by at most one, so the interval is just the operation
/// applied to each end. NaN survives: `Math.floor(NaN)` is NaN.
#[must_use]
pub fn round_to_integer(op: super::UnOp, a: Facts) -> Facts {
    use super::UnOp;
    if !a.has_numeric() {
        return empty_but_nan(a.maybe_nan);
    }
    let apply = |x: f64| match op {
        UnOp::Floor => x.floor(),
        UnOp::Ceil => x.ceil(),
        UnOp::Trunc => x.trunc(),
        // JavaScript rounds a half toward positive infinity, which `floor(x +
        // 0.5)` says exactly and `f64::round` does not: the latter rounds away
        // from zero, making `Math.round(-1.5)` come out `-2` instead of `-1`.
        _ => (x + 0.5).floor(),
    };

    // Any of these can produce `-0`: from `-0` itself, and for everything but
    // `floor` from anything in `(-1, 0)`. `Facts::new` drops the claim again if
    // the result cannot be a zero at all.
    let negative_zero = a.maybe_negative_zero || (!matches!(op, UnOp::Floor) && a.lo < 0.0);
    Facts::new(apply(a.lo), apply(a.hi), true, a.maybe_nan, negative_zero)
}

/// `Math.abs`.
#[must_use]
pub fn abs(a: Facts) -> Facts {
    if !a.has_numeric() {
        return empty_but_nan(a.maybe_nan);
    }
    let (lo, hi) = if a.lo <= 0.0 && a.hi >= 0.0 {
        // Straddles zero, so zero is reachable and is the lower bound.
        (0.0, a.lo.abs().max(a.hi.abs()))
    } else {
        (a.lo.abs().min(a.hi.abs()), a.lo.abs().max(a.hi.abs()))
    };
    // `Math.abs(-0)` is `+0`: the one operation here that cannot produce a
    // negative zero however it is fed.
    Facts::new(lo, hi, a.whole, a.maybe_nan, false)
}

/// `Math.min` and `Math.max`.
///
/// NaN is contagious, unlike C's `fmin`/`fmax`, which pick the other operand.
#[must_use]
pub fn min_max(op: super::BinOp, a: Facts, b: Facts) -> Facts {
    use super::BinOp;
    let maybe_nan = a.maybe_nan || b.maybe_nan;
    if !a.has_numeric() || !b.has_numeric() {
        return empty_but_nan(maybe_nan);
    }
    let (lo, hi) = if matches!(op, BinOp::Min) {
        (a.lo.min(b.lo), a.hi.min(b.hi))
    } else {
        (a.lo.max(b.lo), a.hi.max(b.hi))
    };
    Facts::new(
        lo,
        hi,
        a.whole && b.whole,
        maybe_nan,
        // Either operand's negative zero can be selected: JavaScript orders
        // `-0` below `0` for exactly this purpose.
        a.maybe_negative_zero || b.maybe_negative_zero,
    )
}

/// Apply a binary operator's transfer function.
#[must_use]
pub fn transfer_binary(op: super::BinOp, a: Facts, b: Facts) -> Option<Facts> {
    use super::BinOp;
    Some(match op {
        BinOp::Add => add(a, b),
        BinOp::Sub => sub(a, b),
        BinOp::Mul => mul(a, b),
        BinOp::Div => div(a, b),
        BinOp::Rem => rem(a, b),
        BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr => {
            bitwise(op, a, b)
        }
        BinOp::Min | BinOp::Max => min_max(op, a, b),
        // Comparisons and concatenation do not produce numbers.
        BinOp::Concat | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq | BinOp::Ne => {
            return None;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Values chosen to sit on every boundary the transfer functions branch on:
    /// both zeroes, both infinities, NaN, fractions, the safe-integer limits,
    /// and magnitudes that overflow when multiplied.
    const POOL: &[f64] = &[
        f64::NAN,
        f64::NEG_INFINITY,
        -1e308,
        SAFE_MIN,
        -1e10,
        -7.0,
        -3.5,
        -1.0,
        -0.5,
        -0.0,
        0.0,
        0.5,
        1.0,
        2.0,
        3.0,
        3.5,
        7.0,
        1e10,
        SAFE_MAX,
        1e308,
        f64::INFINITY,
    ];

    /// Every binary transfer function, paired with the arithmetic it abstracts.
    #[allow(clippy::type_complexity)]
    const BINARY: &[(&str, fn(Facts, Facts) -> Facts, fn(f64, f64) -> f64)] = &[
        ("add", add, |a, b| a + b),
        ("sub", sub, |a, b| a - b),
        ("mul", mul, |a, b| a * b),
        ("div", div, |a, b| a / b),
        // Rust's `%` on f64 is fmod: the sign follows the dividend, exactly as
        // JavaScript's remainder does. This is not true of `%` on integers in
        // every language, which is why it is worth saying.
        ("rem", rem, |a, b| a % b),
    ];

    /// The property the whole module rests on: applying a transfer function to
    /// two singletons must produce a set containing the real answer.
    ///
    /// Stated as containment rather than equality so that a precision
    /// improvement is not a test failure. An unsound *widening* of the result
    /// still fails, which is the direction that matters.
    #[test]
    fn every_transfer_function_contains_the_real_answer_for_singletons() {
        for (name, abstract_op, concrete_op) in BINARY {
            for &x in POOL {
                for &y in POOL {
                    let result = abstract_op(Facts::constant(x), Facts::constant(y));
                    let actual = concrete_op(x, y);
                    assert!(
                        result.contains(actual),
                        "{name}({x}, {y}) = {actual}, which is outside {result:?}"
                    );
                }
            }
        }
    }

    /// The same property over intervals rather than points.
    ///
    /// Every two-element subset of the pool becomes an interval, and every pair
    /// of those intervals is checked against every pair of their members —
    /// roughly four million cases. This is where a rule that is right at the
    /// endpoints but wrong in the middle gets caught: multiplication across a
    /// sign change, a NaN that only appears for one corner of the product.
    ///
    /// The point-wise test above found four unsoundnesses on first run, so the
    /// exhaustive version is not paranoia.
    #[test]
    fn every_transfer_function_contains_the_real_answer_for_intervals() {
        let intervals: Vec<(f64, f64, Facts)> = POOL
            .iter()
            .flat_map(|x| POOL.iter().map(move |y| (*x, *y)))
            .map(|(x, y)| (x, y, Facts::constant(x).join(Facts::constant(y))))
            .collect();

        for (name, abstract_op, concrete_op) in BINARY {
            for (ax, ay, a) in &intervals {
                for (bx, by, b) in &intervals {
                    let result = abstract_op(*a, *b);
                    for x in [*ax, *ay] {
                        for y in [*bx, *by] {
                            let actual = concrete_op(x, y);
                            assert!(
                                result.contains(actual),
                                "{name}: {x} in {a:?} and {y} in {b:?} \
                                 give {actual}, outside {result:?}"
                            );
                        }
                    }
                }
            }
        }
    }

    /// The same containment property for the operations that establish
    /// wholeness. These are the ones a specialization decision rests on, so an
    /// unsound bound here is an unsound integer somewhere downstream.
    #[test]
    fn rounding_and_abs_contain_the_real_answer() {
        use super::super::UnOp;
        /// An abstract rounding operation paired with the arithmetic it
        /// abstracts.
        type Rounding = (UnOp, fn(f64) -> f64);
        let cases: &[Rounding] = &[
            (UnOp::Floor, f64::floor),
            (UnOp::Ceil, f64::ceil),
            (UnOp::Trunc, f64::trunc),
            // JavaScript's rounding, not Rust's: half goes toward positive
            // infinity, so `Math.round(-1.5)` is `-1`.
            (UnOp::Round, |x| (x + 0.5).floor()),
        ];
        for &x in POOL {
            for (op, concrete) in cases {
                let result = round_to_integer(*op, Facts::constant(x));
                let actual = concrete(x);
                assert!(
                    result.contains(actual),
                    "{op:?}({x}) = {actual}, outside {result:?}"
                );
            }
            let result = abs(Facts::constant(x));
            assert!(
                result.contains(x.abs()),
                "abs({x}) = {}, outside {result:?}",
                x.abs()
            );
        }

        // And over intervals, where a rule can be right at both ends and wrong
        // between them.
        for &x in POOL {
            for &y in POOL {
                let set = Facts::constant(x).join(Facts::constant(y));
                for (op, concrete) in cases {
                    let result = round_to_integer(*op, set);
                    for member in [x, y] {
                        assert!(
                            result.contains(concrete(member)),
                            "{op:?}: {member} in {set:?} gives {}, outside {result:?}",
                            concrete(member)
                        );
                    }
                }
                let result = abs(set);
                for member in [x, y] {
                    assert!(result.contains(member.abs()), "abs over {set:?}");
                }
            }
        }
    }

    #[test]
    fn min_and_max_are_not_fmin_and_fmax() {
        use super::super::BinOp;
        // C's `fmin(1, NaN)` is `1`. JavaScript's `Math.min(1, NaN)` is NaN,
        // and a domain that borrowed C's rule would prove a number where the
        // program has none.
        let result = min_max(BinOp::Min, Facts::constant(1.0), Facts::constant(f64::NAN));
        assert!(result.maybe_nan, "{result:?}");
        // `whole` describes the interval's members, and NaN is not one of them
        // — it has no ordering, which is exactly why it needs its own flag. What
        // protects a specialization decision is that `is_integral_within`
        // refuses anything that may be NaN at all.
        assert!(result.contains(f64::NAN));

        for &x in POOL {
            for &y in POOL {
                let (a, b) = (Facts::constant(x), Facts::constant(y));
                let smallest = min_max(BinOp::Min, a, b);
                let largest = min_max(BinOp::Max, a, b);
                let (real_min, real_max) = if x.is_nan() || y.is_nan() {
                    (f64::NAN, f64::NAN)
                } else {
                    (x.min(y), x.max(y))
                };
                assert!(smallest.contains(real_min), "min({x},{y}) {smallest:?}");
                assert!(largest.contains(real_max), "max({x},{y}) {largest:?}");
            }
        }
    }

    #[test]
    fn negation_contains_the_real_answer() {
        for &x in POOL {
            let result = neg(Facts::constant(x));
            assert!(result.contains(-x), "neg({x}) = {} outside {result:?}", -x);
        }
    }

    #[test]
    fn zero_times_infinity_is_not_zero() {
        // The mistake an interval-only domain makes: the endpoint product is 0,
        // so the interval says [0, 0] and a caller concludes the value is a
        // whole number. It may be NaN.
        let result = mul(Facts::constant(0.0), Facts::constant(f64::INFINITY));
        assert!(result.maybe_nan);
        assert!(!result.whole, "NaN is not a whole number");
    }

    #[test]
    fn remainder_takes_the_sign_of_the_dividend() {
        // `-7 % 3` is `-1` in JavaScript, not the mathematician's `2`. A domain
        // that assumed the divisor's sign would prove `[0, 2]` and be wrong.
        let result = rem(
            Facts::new(-7.0, -7.0, true, false, false),
            Facts::new(3.0, 3.0, true, false, false),
        );
        assert!(result.contains(-1.0), "{result:?} should contain -1");
        assert!(
            result.lo < 0.0,
            "a negative dividend gives a negative result"
        );
    }

    #[test]
    fn negative_zero_survives_where_it_is_observable() {
        // `1 / -0` is `-Infinity` and `1 / 0` is `+Infinity`. Storing a `-0` in
        // an integer slot loses a distinction the program can see, so the flag
        // has to be tracked even though no interval can express it.
        assert!(Facts::constant(-0.0).maybe_negative_zero);
        assert!(!Facts::constant(0.0).maybe_negative_zero);
        // Negating any set containing zero can produce it.
        assert!(neg(Facts::constant(0.0)).maybe_negative_zero);
        // But `0 + 0` cannot: only `-0 + -0` is `-0`.
        assert!(!add(Facts::constant(0.0), Facts::constant(0.0)).maybe_negative_zero);
    }

    #[test]
    fn division_does_not_preserve_wholeness() {
        // Two integers divide to a fraction. A domain that propagated wholeness
        // through division would prove `7 / 2` whole and emit integer division.
        let seven = Facts::constant(7.0);
        let two = Facts::constant(2.0);
        assert!(seven.whole && two.whole);
        let result = div(seven, two);
        assert!(result.contains(3.5));
    }

    #[test]
    fn an_infinite_bound_refutes_wholeness() {
        // Infinity is not an integer, so a set that may contain one cannot claim
        // every member is whole — however the flag was passed in.
        let claimed = Facts::new(0.0, f64::INFINITY, true, false, false);
        assert!(!claimed.whole);
    }

    #[test]
    fn widening_jumps_to_a_threshold_rather_than_crawling() {
        // A counter growing by one per round would need as many rounds as the
        // loop has iterations. Widening jumps a still-growing bound to the next
        // point where a verdict could change.
        let prev = Facts::new(0.0, 1.0, true, false, false);
        let next = Facts::new(0.0, 2.0, true, false, false);
        let widened = widen(prev, next);
        assert!(widened.hi >= 2_147_483_647.0, "{widened:?}");
        // A bound that is not growing is left alone.
        assert_eq!(
            widen(prev, Facts::new(0.0, 1.0, true, false, false)).hi,
            1.0
        );
    }

    #[test]
    fn joining_an_unreachable_path_contributes_nothing() {
        let known = Facts::new(1.0, 5.0, true, false, false);
        assert_eq!(known.join(Facts::BOTTOM), known);
        assert_eq!(Facts::BOTTOM.join(known), known);
    }
}
