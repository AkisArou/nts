//! Replacing computations whose answer is already known.
//!
//! # Why the analysis should do this rather than the C compiler
//!
//! Because it knows things the C compiler cannot. `ToInt32(0.0)` is the
//! coercion half of `x | 0`, and it lowers to a call that reduces modulo 2^32
//! with `fmod` — total, correct, and expensive. Clang will not fold it away,
//! because from clang's side it is an opaque function of a runtime value.
//!
//! The analysis already proved the answer is exactly `0`. Saying so turns a
//! library call in a loop body into a constant.

use super::facts::Facts;
use super::flow::Analysis;
use super::{BinOp, Func, HirType, OpKind, ValueId};

/// Replace pure operations of known result with constants, and report how many.
pub fn fold(func: &mut Func, analysis: &Analysis) -> usize {
    let hole_reads = super::holes::read_observations(func);
    let mut folded = 0;
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));

        // A parameter is an input and a call may have effects; neither is a
        // computation whose result can simply be written down. Constants are
        // already what they would be folded to.
        if matches!(
            func.values[index].kind,
            OpKind::Param(_)
                | OpKind::BlockParam(_)
                | OpKind::Call { .. }
                | OpKind::ConstInt(_)
                | OpKind::ConstHandle(_)
                | OpKind::ConstFloat(_)
                | OpKind::DispatchSlot(_)
                | OpKind::ConstBool(_)
                | OpKind::ConstString(_)
                | OpKind::Return(_)
        ) {
            continue;
        }
        // Bounds and initialization are separate obligations. A read that
        // may stop is its value only after the corresponding check returns.
        if super::may_stop(&func.values[index]) || hole_reads.contains(&id) {
            continue;
        }
        // Two string constants joined are a string constant. Values come in
        // definition order, so a chain folds from its first link outward.
        if let OpKind::Binary {
            op: BinOp::Concat,
            lhs,
            rhs,
        } = func.values[index].kind
            && let Some(joined) = joined_constant(func, lhs, rhs)
        {
            func.values[index].kind = OpKind::ConstString(joined);
            folded += 1;
            continue;
        }

        let facts = analysis.get(id);
        if !exactly_one_value(facts) {
            continue;
        }
        // The constant takes the value's own type. An integer -- a C integer's
        // argument after `ToInt32` and its `Convert` -- is an integer constant;
        // a float constant typed `i32` is something C converts silently and
        // LLVM rejects (`'%v12' defined with type 'double' but expected 'i32'`).
        // Anything that is not a number keeps its operation.
        func.values[index].kind = match func.values[index].ty {
            HirType::Float { .. } => OpKind::ConstFloat(facts.lo),
            #[allow(clippy::cast_possible_truncation)]
            HirType::Int { .. } if facts.lo.fract() == 0.0 => OpKind::ConstInt(facts.lo as i128),
            _ => continue,
        };
        folded += 1;
    }
    folded
}

/// The longest string constant a fold will write.
///
/// A source of n lines can spell a string of 2^n units -- `const b = a + a;`,
/// `const c = b + b;`, and on -- and the compiler is not where that string should
/// be built. Past this the concatenation stays the program's, at run time, which
/// is where it was.
const JOINED_MAX: usize = 1 << 16;

/// Two string constants as one, where joining their bytes is joining their
/// UTF-16 units.
///
/// `json-scan` builds its input as four literals joined on every call, and the
/// Wasm backend then scanned a string the engine kept as a chain of pieces: the
/// scan ran at 0.58 of its time once the input was one literal, with the
/// scanner's own code unchanged. A constant is a constant on every backend.
///
/// Bytes are units except at one junction. A lone surrogate held in its
/// three-byte generalized UTF-8 form, as a high one ending a constant followed
/// by a low one starting the next, would join into the two halves' bytes where
/// JavaScript sees one character, whose bytes are the pair's four. That
/// junction is left to run time rather than taught a second encoding here.
/// Today it cannot arise: a lone surrogate in a literal reaches this program as
/// three U+FFFD (tests/outcomes/lone-surrogates-compare-as-one-character), and
/// the fix recorded there reads the literal's own bytes -- this form.
fn joined_constant(func: &Func, lhs: ValueId, rhs: ValueId) -> Option<String> {
    let (OpKind::ConstString(left), OpKind::ConstString(right)) = (
        &func.values[lhs.0 as usize].kind,
        &func.values[rhs.0 as usize].kind,
    ) else {
        return None;
    };
    if left.len() + right.len() > JOINED_MAX {
        return None;
    }
    let (head, tail) = (left.as_bytes(), right.as_bytes());
    let ends_high = head.len() >= 3
        && head[head.len() - 3] == 0xED
        && (0xA0..=0xAF).contains(&head[head.len() - 2]);
    let starts_low = tail.len() >= 3 && tail[0] == 0xED && (0xB0..=0xBF).contains(&tail[1]);
    if ends_high && starts_low {
        return None;
    }
    Some(format!("{left}{right}"))
}

/// Whether a set is one value that can be written as a literal.
///
/// A singleton at zero that may be negative zero is *two* values as far as
/// anything observable goes — `1 / -0` and `1 / 0` differ — and the interval
/// cannot say which. Refusing to fold it is the only safe reading.
fn exactly_one_value(facts: Facts) -> bool {
    facts.is_singleton()
        && !facts.maybe_nan
        && facts.lo.is_finite()
        && !(facts.lo == 0.0 && facts.maybe_negative_zero)
}

/// Decide a branch whose condition is already a constant, so the arm nothing can
/// enter stops being part of the program.
///
/// **A constant comparison is the `typeof` family**, and it is how a copy of a
/// generic produces *invalid HIR*. A copy knows what its type parameter binds, so
/// `typeof held` in `bare<str>` lowers to the constant `"string"` -- and the
/// comparison beside it was left as a runtime `eq` of two constants, with the arm
/// behind it lowered as written:
///
/// ```text
/// %1 = const "string"
/// %2 = const "number"
/// %3 = eq %1, %2 : bool
/// br %3, b1, b2
/// b1: %5 = mul %0, 2        <- %0 is a string
/// ```
///
/// `OperandsDiffer { op: "*", left: Managed(String), right: Float }`, and
/// `emit-c` then refuses **the whole program** rather than one function:
///
/// ```ts
/// function bare<S>(value: S): number {
///   const held: S = value;
///   return typeof held === "number" ? held * 2 : 0;
/// }
/// export function bareText(word: string): number { return bare(word); }
/// ```
///
/// `lower::statically_decided` cannot see it and should not be asked to: it reads
/// the *checker's* type for the condition, and the checker is typing the
/// declaration, where `S` may perfectly well be a number. The fact only exists
/// once a copy has substituted, which is after lowering.
///
/// # Strings and tags only
///
/// A float comparison has `NaN` and two zeroes in it, and the reasoning for those
/// is [`exactly_one_value`]'s, over intervals the analysis proved. Nothing here
/// needs it: the shape that produces invalid HIR is `typeof`, whose operands are
/// string literals the lowering wrote itself, and the shape run again after
/// `simplify` is a tag it decided. See [`same_constant`].
///
/// # Why here, before `dce::prune_unreachable_blocks`
///
/// Because that is what removes the block, and `dce::eliminate` is what then
/// removes the operation with nothing listing it. Folding later leaves the `mul`
/// in the value arena, and `verify::check_operands` walks the arena rather than
/// the block graph -- so a fold after pruning would decide the branch and still
/// report the program invalid.
pub fn decided_branches(program: &mut super::Program) -> usize {
    program.funcs.iter_mut().map(decide).sum()
}

fn decide(func: &mut Func) -> usize {
    let mut decided = 0;
    for index in 0..func.values.len() {
        let super::OpKind::Binary { op, lhs, rhs } = func.values[index].kind else {
            continue;
        };
        let Some(equal) = same_constant(func, lhs, rhs) else {
            continue;
        };
        let answer = match op {
            super::BinOp::Eq => equal,
            super::BinOp::Ne => !equal,
            _ => continue,
        };
        func.values[index].kind = OpKind::ConstBool(answer);
        decided += 1;
    }
    // Collected first: the decision reads the value arena and the rewrite writes
    // the block list, and one loop cannot hold both.
    let taken: Vec<(usize, super::Terminator)> = func
        .blocks
        .iter()
        .enumerate()
        .filter_map(|(at, block)| {
            let super::Terminator::Branch {
                cond,
                then_target,
                then_args,
                else_target,
                else_args,
            } = &block.terminator
            else {
                return None;
            };
            let OpKind::ConstBool(answer) = func.values[cond.0 as usize].kind else {
                return None;
            };
            let (target, args) = if answer {
                (*then_target, then_args)
            } else {
                (*else_target, else_args)
            };
            Some((
                at,
                super::Terminator::Jump {
                    target,
                    args: args.clone(),
                },
            ))
        })
        .collect();
    decided += taken.len();
    for (at, terminator) in taken {
        func.blocks[at].terminator = terminator;
    }
    decided
}

/// Whether two values are string or same-typed integer constants, and whether
/// they are equal.
///
/// **Strings and integers and nothing else**, because `typeof` is the only
/// thing that makes a decidable comparison this pass has to answer: before
/// preparation its operands are string literals the lowering wrote itself, and
/// after `simplify` decides the tag of an erased scalar they are two tags. A float comparison belongs to
/// [`exactly_one_value`]'s interval reasoning, which has `NaN` and the two zeroes
/// in it. A boolean one would be exact and is left out for want of a program that
/// reaches it -- `lower::statically_decided` already folds every `=== true` the
/// checker can see, so a fold here would be a branch with no fixture.
///
/// `None` for anything else, including two constants of *different* kinds: saying
/// `false` for those would be a claim about coercion rather than a fact about the
/// values.
fn same_constant(func: &Func, lhs: ValueId, rhs: ValueId) -> Option<bool> {
    match (
        &func.values[lhs.0 as usize].kind,
        &func.values[rhs.0 as usize].kind,
    ) {
        (OpKind::ConstString(a), OpKind::ConstString(b)) => Some(a == b),
        // Two integers of one type compare exactly. A tag read the erasure
        // decided is one: `typeof value === "number"` on an erased number
        // becomes `eq 2, 2` once `simplify` folds the tag, and the branch is
        // then as decided as a `typeof` of a generic copy's literal.
        (OpKind::ConstInt(a), OpKind::ConstInt(b))
            if func.values[lhs.0 as usize].ty == func.values[rhs.0 as usize].ty =>
        {
            Some(a == b)
        }
        _ => None,
    }
}
