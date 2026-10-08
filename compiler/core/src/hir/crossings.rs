//! Where a number crosses into a fixed-width native integer, and whether the
//! range analysis proves it fits.
//!
//! # Why this exists
//!
//! `docs/scalar-numbers.md` makes every such crossing *strict*: proven to fit,
//! or a compile error, with no check nts inserts. Today a `number` handed to a
//! C `int` goes through JavaScript's `ToInt32` instead (`integer_argument` in
//! the lowering), so `2**31` arrives as `-2147483648` and `w / 3` is
//! truncated, silently.
//!
//! This is step 0 of that plan: the census, which changes nothing. It lists
//! each crossing with what [`super::flow`] knows about the value there, so the
//! cost of strictness is measured before it is imposed, and each unproven
//! crossing can be classified -- a real bug in the program, or a fact the
//! analysis lacks.
//!
//! **One enumeration, two readers.** Step 1's strict check refuses exactly
//! the crossings this reports as unproven. Were the census a separate walk, it
//! could count crossings the check never sees, or miss ones it refuses, and
//! the measurement would be of something else.
//!
//! # What counts as a crossing
//!
//! A value of integer representation reaching native code, made from a
//! JavaScript `number` or `bigint`:
//! - **an argument** of a native call (`Callee::Native`), whatever its role:
//!   a parameter the program passed, or a count the lowering derived;
//! - **a store through a native pointer** (`NativeStore`): a struct field or a
//!   buffer element. A store into a C struct is a call in disguise -- C reads
//!   it as surely as an argument.
//!
//! The value is made by one of the lowering's two conversions: the
//! `ToInt32`-family helper ([`super::builtin`]'s `element_coercion`, for 32
//! bits or fewer) or a `Convert` (wider, or a `bigint`). A typed array's store
//! uses the first helper too, and is deliberately *not* a crossing: it keeps
//! JavaScript's wrapping semantics (decision C27).
//!
//! Not yet counted, and said so rather than missed: a value a callback or an
//! export *returns* to native code. Its conversion happens in the backend's
//! bridge, not in the HIR this reads.
//!
//! # Which facts may prove a crossing (decision Q2)
//!
//! **Only local ones:** what the function proves alone, its loop bounds, and
//! its written types (a parameter's declared type). Never what callers pass,
//! nor what the whole program stores into a field. The whole-program analysis
//! makes code fast; it must not decide whether code compiles. Otherwise
//! adding a caller in one file breaks a native call in another, and a
//! speculative copy's facts would pass for proof. [`local_analysis`] is that
//! rule, in one place.

use nts_diagnostics::Location;

use rustc_hash::FxHashMap;

use super::facts::Facts;
use super::flow::{Analysis, Context, Whole};
use super::{BlockId, Callee, Func, HirType, OpKind, Program, ValueId};

/// The `ToInt32`-family helpers: a `number` to an integer of 32 bits or fewer.
const TO_INTEGER: [&str; 6] = ["nts_to_int8", "nts_to_uint8", "nts_to_int16", "nts_to_uint16", "nts_to_int32", "nts_to_uint32"];

/// Where the crossing goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Into {
    /// The `position`th argument of the native function `function`.
    Argument { function: String, position: usize, c_type: String },
    /// A store through a native pointer: a struct field or a buffer element.
    Store { c_type: String },
}

/// What crosses: a `number` (with what the analysis knows), or a `bigint`,
/// for which the analysis has no ranges yet.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Source {
    Number(Facts),
    /// A `bigint`: its literal value when it is one, and otherwise unknown.
    BigInt(Option<i128>),
}

/// Why a crossing isn't proven.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Why {
    /// It may not be a whole number.
    Fraction,
    /// It may be NaN.
    NaN,
    /// It may be below the integer's least value: the analysis's lower bound.
    Below(f64),
    /// It may be above the integer's greatest value: the analysis's upper
    /// bound.
    Above(f64),
    /// A `bigint` that isn't a literal: the analysis has no bigint ranges.
    NoBigIntRanges,
    /// A `bigint` literal outside the integer's range.
    LiteralOutside(i128),
}

/// One crossing, and the verdict on it.
#[derive(Debug, Clone, PartialEq)]
pub struct Crossing {
    /// The program function the crossing is in.
    pub func: String,
    /// Where in the source.
    pub location: Location,
    pub into: Into,
    /// The integer's width in bits and whether it is signed.
    pub bits: u32,
    pub signed: bool,
    pub source: Source,
    /// Empty when proven.
    pub unproven: Vec<Why>,
}

impl Crossing {
    #[must_use]
    pub fn proven(&self) -> bool {
        self.unproven.is_empty()
    }

    /// The integer's least and greatest values.
    #[must_use]
    pub fn range(&self) -> (i128, i128) {
        range_of(self.bits, self.signed)
    }
}

fn range_of(bits: u32, signed: bool) -> (i128, i128) {
    let bits = bits.min(127);
    if signed {
        (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1)
    } else {
        (0, (1i128 << bits) - 1)
    }
}

/// Every crossing in `program`, each judged by [`local_analysis`].
#[must_use]
pub fn census(program: &Program) -> Vec<Crossing> {
    program.funcs.iter().flat_map(|func| in_func(func, &local_analysis(func))).collect()
}

/// What a strict obligation may rely on in `func` (decision Q2): the function
/// alone, with its declared parameter types, and its loops' bounds -- which
/// [`super::loops::accumulator_caps`] counts from the function itself. The caps
/// feed the analysis and the analysis feeds the caps, so the two are run to a
/// fixpoint, as the whole-program driver runs them.
#[must_use]
pub fn local_analysis(func: &Func) -> Analysis {
    let whole = Whole::default();
    let mut caps: FxHashMap<ValueId, Facts> = FxHashMap::default();
    let analyze = |caps: &FxHashMap<ValueId, Facts>| {
        super::flow::analyze_with(func, &Context { params: &[], caps, param_lengths: &[], whole: &whole })
    };
    let mut analysis = analyze(&caps);
    // Each round only adds caps it has proven; a loop nest is not deeper than
    // the function has blocks, which bounds the rounds.
    for _ in 0..func.blocks.len().max(1) {
        let next = super::loops::accumulator_caps(func, &analysis);
        if next == caps {
            break;
        }
        caps = next;
        analysis = analyze(&caps);
    }
    analysis
}

fn in_func(func: &Func, analysis: &Analysis) -> Vec<Crossing> {
    let mut found = Vec::new();
    for (block_index, block) in func.blocks.iter().enumerate() {
        let block_id = BlockId(u32::try_from(block_index).unwrap_or(u32::MAX));
        for &value in &block.ops {
            let op = func.value(value);
            match &op.kind {
                OpKind::Call { callee: Callee::Native(target), args, .. } => {
                    for (position, &argument) in args.iter().enumerate() {
                        let c_type = target.parameters.get(position).map_or_else(String::new, |ty| ty.c_type().into_owned());
                        let into = Into::Argument { function: target.name.clone(), position, c_type };
                        found.extend(crossing(func, analysis, block_id, argument, into));
                    }
                }
                OpKind::NativeStore { pointer, value: stored, .. } => {
                    let c_type = match &func.value(*pointer).ty {
                        HirType::NativePointer(pointee) => pointee.c_type(),
                        _ => String::new(),
                    };
                    found.extend(crossing(func, analysis, block_id, *stored, Into::Store { c_type }));
                }
                _ => {}
            }
        }
    }
    found
}

/// The crossing `value` makes into `into`, if it is a `number` or `bigint`
/// converted to a native integer.
fn crossing(func: &Func, analysis: &Analysis, block: BlockId, value: ValueId, into: Into) -> Option<Crossing> {
    let made = func.value(value);
    let HirType::Int { bits, signed } = made.ty else {
        return None;
    };
    let bits = u32::from(bits);
    let operand = match &made.kind {
        OpKind::Call { callee: Callee::External(name), args, .. } if TO_INTEGER.contains(&name.as_str()) => *args.first()?,
        OpKind::Convert(from) => *from,
        _ => return None,
    };
    let (lo, hi) = range_of(bits, signed);
    let (source, unproven) = match func.value(operand).ty {
        HirType::Float { .. } => {
            let facts = analysis.get_at(block, operand);
            let mut why = Vec::new();
            if !facts.whole {
                why.push(Why::Fraction);
            }
            if facts.maybe_nan {
                why.push(Why::NaN);
            }
            // As `f64`: the integer bounds are exact up to 2^53, and past it
            // no `number` is provably whole anyway.
            #[allow(clippy::cast_precision_loss)]
            let (lo_f, hi_f) = (lo as f64, hi as f64);
            if facts.lo < lo_f {
                why.push(Why::Below(facts.lo));
            }
            if facts.hi > hi_f {
                why.push(Why::Above(facts.hi));
            }
            (Source::Number(facts), why)
        }
        HirType::BigInt => {
            let literal = match func.value(operand).kind {
                OpKind::ConstInt(literal) => Some(literal),
                _ => None,
            };
            let why = match literal {
                Some(literal) if literal < lo || literal > hi => vec![Why::LiteralOutside(literal)],
                Some(_) => Vec::new(),
                None => vec![Why::NoBigIntRanges],
            };
            (Source::BigInt(literal), why)
        }
        _ => return None,
    };
    Some(Crossing {
        func: func.name.clone(),
        location: made.origin.location,
        into,
        bits,
        signed,
        source,
        unproven,
    })
}

#[cfg(test)]
mod tests {
    use super::range_of;

    #[test]
    fn ranges_are_the_integer_widths() {
        assert_eq!(range_of(8, false), (0, 255));
        assert_eq!(range_of(8, true), (-128, 127));
        assert_eq!(range_of(32, true), (-2_147_483_648, 2_147_483_647));
        assert_eq!(range_of(64, false), (0, 18_446_744_073_709_551_615));
    }
}
