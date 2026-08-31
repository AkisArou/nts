//! Choosing an integer representation where one is provable.
//!
//! # What this pass is allowed to assume
//!
//! Nothing. [`flow::analyze`] proves what it proves, and every decision here
//! is downstream of a proof. Where the proof is absent the value stays an `f64`,
//! which is always correct and sometimes slower — the only acceptable direction
//! for the error.
//!
//! # Why the decision is per class and not per value
//!
//! A block parameter and every argument passed to it are one storage location
//! seen from different edges. Deciding them separately would let a header
//! parameter be an `i32` while a back edge hands it a `double`, which is not a
//! conversion problem but a wrong program: the two disagree about what the bits
//! mean.
//!
//! So values are first joined into classes by the edges that connect them, and a
//! class becomes an integer only if *every* member is provably an integer. One
//! unprovable member sinks the class — which is the right answer, because the
//! alternative is a conversion on a loop back edge, every iteration, to save
//! arithmetic that was only worth saving because it was cheap.
//!
//! # Where conversions come from
//!
//! Only from uses, never from edges. An edge cannot need one, by the paragraph
//! above. What can need one is an integer feeding a floating-point operation, a
//! call (signatures are not specialized), or a return. Each is one instruction,
//! and each is visible in the emitted code.

use rustc_hash::{FxHashMap, FxHashSet};

use super::facts;
use super::flow::Analysis;
use super::{BinOp, Block, Callee, Func, HirType, Op, OpKind, UnOp, ValueId};

/// Bounds of the representations this pass will choose.
const I32_MIN: f64 = -2_147_483_648.0;
const I32_MAX: f64 = 2_147_483_647.0;
/// The largest `uint32`, for the same reason.
const U32_MAX: f64 = 4_294_967_295.0;

/// What one pass achieved, for the report `nts` prints and the tests assert on.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Report {
    /// Values that became integers.
    pub specialized: usize,
    /// Conversions the choice cost.
    pub conversions: usize,
}

/// Disjoint sets over values, for "these must agree about representation".
struct Classes {
    parent: Vec<u32>,
}

impl Classes {
    fn new(len: usize) -> Self {
        Self {
            parent: (0..u32::try_from(len).unwrap_or(u32::MAX)).collect(),
        }
    }

    fn find(&mut self, value: u32) -> u32 {
        let mut root = value;
        while self.parent[root as usize] != root {
            root = self.parent[root as usize];
        }
        // Path compression, so a long chain of block parameters through nested
        // loops does not make this quadratic.
        let mut current = value;
        while self.parent[current as usize] != root {
            let next = self.parent[current as usize];
            self.parent[current as usize] = root;
            current = next;
        }
        root
    }

    fn union(&mut self, a: u32, b: u32) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.parent[b as usize] = a;
        }
    }
}

/// Rewrite a function to use integers wherever that is provable.
pub fn specialize(
    func: &mut Func,
    analysis: &Analysis,
    expected: &super::signatures::Expected,
) -> Report {
    let count = func.values.len();
    let mut classes = Classes::new(count);

    // Edges: a block parameter and every argument passed to it are one location.
    for block in &func.blocks {
        for (target, args) in edges(block) {
            for (param, arg) in func.blocks[target].params.iter().zip(args) {
                classes.union(param.0, arg.0);
            }
        }
    }

    // A comparison joins its two operands to each other, but not to its result,
    // which is a bool whatever they are. Without this, `i < 1000` leaves the
    // literal an integer and `i` a double and the loop pays a conversion every
    // iteration to compare them — and, worse, a lone constant compared against
    // an unprovable double gets specialized for no benefit at all.
    //
    // Arithmetic operands are deliberately *not* joined. They were, and it cost
    // more than it saved: in `for (let i = 0; i < 1000; i++) total += i`, the
    // accumulator is not provably bounded — it grows by an amount the analysis
    // cannot relate to the iteration count — so joining `total` to `i` sank the
    // counter with it and the loop specialized nothing. Left apart, the counter
    // and its comparison become integers and only the accumulation pays a
    // conversion. Safety does not depend on this: an arithmetic operation is
    // integer-eligible only if its operands are *provably* integral, so any
    // conversion it needs is exact.
    for value in &func.values {
        if let OpKind::Binary { op, lhs, rhs } = &value.kind
            && op.is_comparison()
            // ...unless one side is a function parameter. Its representation is
            // the signature, so it can never move, and joining to it can only
            // drag the other side down with it. `for (i = 0; i < limit; i++)`
            // with `limit: 100` would otherwise specialize nothing at all: the
            // counter is provable, the parameter is immovable, and the class is
            // only as good as its worst member. Converting the parameter at the
            // comparison costs one instruction, which the C compiler hoists out
            // of the loop because it does not change.
            && !is_parameter(func, *lhs)
            && !is_parameter(func, *rhs)
        {
            classes.union(lhs.0, rhs.0);
        }
    }

    // What each value could be on its own, ignoring the company it keeps.
    let observed = super::zero_sign::observed(func);
    let eligible: Vec<Option<u8>> = (0..count)
        .map(|index| width_of(func, analysis, &observed, index))
        .collect();

    // A class is only as good as its worst member, and needs the widest
    // representation any member asked for.
    let mut verdict: FxHashMap<u32, Option<u8>> = FxHashMap::default();
    for (index, own) in eligible.iter().enumerate() {
        let root = classes.find(u32::try_from(index).unwrap_or(0));
        let slot = verdict.entry(root).or_insert(Some(32));
        *slot = match (*slot, own) {
            (Some(a), Some(b)) => Some(a.max(*b)),
            _ => None,
        };
    }

    // A class with no arithmetic in it has nothing to make faster. Specializing
    // one costs a conversion at every use and saves nothing — which is exactly
    // what a lone `const 5` compared against a double was doing.
    //
    // Arithmetic reaches a class in two ways, and both have to count. The
    // obvious one is *being* the arithmetic. The other is *feeding* it: a code
    // unit multiplied by something, an `indexOf` added to a total. Arithmetic
    // operands are deliberately not joined into one class -- doing that let one
    // unprovable operand sink the other -- so an operand sits in a class of its
    // own, and judging that class on its own contents says it has nothing to
    // gain. It has: the conversion at the use is the thing being avoided.
    let mut worthwhile: FxHashMap<u32, bool> = FxHashMap::default();
    for (index, value) in func.values.iter().enumerate() {
        let pays = match &value.kind {
            OpKind::Binary { op, .. } => !op.is_comparison(),
            OpKind::Unary { .. } | OpKind::BlockParam(_) => true,
            _ => false,
        };
        if !pays {
            continue;
        }
        worthwhile.insert(classes.find(u32::try_from(index).unwrap_or(0)), true);
        for operand in super::verify::operands(&value.kind) {
            worthwhile.insert(classes.find(operand.0), true);
        }
    }

    let unsigned = unsigned_classes(func, analysis, &mut classes, count);

    let mut report = Report::default();
    for index in 0..count {
        let root = classes.find(u32::try_from(index).unwrap_or(0));
        let Some(Some(bits)) = verdict.get(&root).copied() else {
            continue;
        };
        if !worthwhile.get(&root).copied().unwrap_or(false) {
            continue;
        }
        report.specialized += 1;
        func.values[index].ty = HirType::Int {
            bits,
            signed: !unsigned.contains(&root),
        };
        // A float constant that is provably whole is an integer constant. Left
        // as a float it would be converted back on every use.
        if let OpKind::ConstFloat(value) = func.values[index].kind {
            #[allow(clippy::cast_possible_truncation)]
            let exact = value as i128;
            func.values[index].kind = OpKind::ConstInt(exact);
        }
    }

    // A coercion whose operand is already provably in range is a truncation,
    // and C spells that as a cast. The general helper exists for values that
    // might be anything at all — NaN, an infinity, 1e21 — and a value proven not
    // to be any of those should not pay for the possibility.
    //
    // The range is what has to be proven, not integrality: `(int32_t)3.7` is
    // `3`, which is exactly what `ToInt32(3.7)` is.
    for index in 0..count {
        let OpKind::Unary {
            op: op @ (UnOp::ToInt32 | UnOp::ToUint32),
            operand,
        } = func.values[index].kind
        else {
            continue;
        };
        // Only where specialization gave the result an int32 to be converted
        // *to*; a `Convert` to `f64` would be a different operation entirely.
        let HirType::Int { bits: 32, signed } = func.values[index].ty else {
            continue;
        };
        // Two ranges intersected: where the coercion is the identity, and what
        // the result type holds. `ToInt32` is the identity below 2^31 and
        // wraps above it; `ToUint32` is the identity above zero and wraps
        // below. The result's signedness is decided by the *value* range, so
        // `x >>> 3` on a small number lands in a signed int32 and is still a
        // plain cast.
        let (low, high) = match op {
            UnOp::ToInt32 => (if signed { I32_MIN } else { 0.0 }, I32_MAX),
            _ => (0.0, if signed { I32_MAX } else { U32_MAX }),
        };
        // The exact range, with no slack. C leaves a float-to-integer
        // conversion undefined when the truncated value does not fit, so an
        // operand allowed to reach `I32_MAX + 1` is one whose cast is undefined
        // on the boundary -- and `ToInt32` is defined there, by wrapping. What
        // slack would buy is a fractional value just past the bound, which is
        // not a shape programs have.
        if analysis.is_within(operand, low, high) {
            func.values[index].kind = OpKind::Convert(operand);
        }
    }

    report.conversions = insert_conversions(func, analysis, expected);
    report
}

/// Whether a value is one of the function's own parameters.
fn is_parameter(func: &Func, value: ValueId) -> bool {
    matches!(func.values[value.0 as usize].kind, OpKind::Param(_))
}

/// The edges a block's terminator carries, as (target, arguments).
fn edges(block: &Block) -> Vec<(usize, &[ValueId])> {
    match &block.terminator {
        super::Terminator::Jump { target, args } => vec![(target.0 as usize, args.as_slice())],
        super::Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => vec![
            (then_target.0 as usize, then_args.as_slice()),
            (else_target.0 as usize, else_args.as_slice()),
        ],
        super::Terminator::Return(_)
        | super::Terminator::Unreachable
        | super::Terminator::FellThrough => Vec::new(),
    }
}

/// The narrowest integer this value is provably within, if any.
fn width_of(
    func: &Func,
    analysis: &Analysis,
    observed: &rustc_hash::FxHashSet<ValueId>,
    index: usize,
) -> Option<u8> {
    let id = ValueId(u32::try_from(index).unwrap_or(0));
    if !matches!(func.values[index].ty, HirType::Float { .. }) {
        return None;
    }

    // `-0` and `0` are different doubles and the same integer, so a value that
    // might be `-0` cannot normally be one. Where nothing downstream can tell
    // the two apart it can: see `super::zero_sign` for what counts as telling.
    // Without this a product is stuck in floating point because `0 * -5` is
    // `-0`, and that one fact drags an entire accumulator with it.
    let integral = |value: ValueId, lo: f64, hi: f64| {
        if observed.contains(&value) {
            analysis.is_integral_within(value, lo, hi)
        } else {
            analysis.is_integral_within_ignoring_zero_sign(value, lo, hi)
        }
    };

    let provable = |value: ValueId| {
        integral(value, I32_MIN, I32_MAX) || integral(value, facts::SAFE_MIN, facts::SAFE_MAX)
    };

    let usable = match &func.values[index].kind {
        OpKind::Binary {
            op: BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Rem,
            lhs,
            rhs,
        } => {
            // The result being whole does not make the operands whole — `7.0 /
            // 3.5` is `2` — and converting an operand that is not would
            // silently truncate it.
            provable(*lhs) && provable(*rhs)
        }
        OpKind::Unary {
            op: UnOp::Neg,
            operand,
        } => provable(*operand),
        // Always integral, and the middle two are the interesting half of this
        // pass. A coercion's result is an integer by construction whatever
        // reached it — the one place a value becomes provably integral with
        // nothing upstream having been provable, which is what makes `x | 0`
        // and `x & 1023` worth writing. A bitwise result is likewise int32 by
        // the language's definition rather than by inference, its operands
        // having been coerced on the way in.
        OpKind::Unary {
            op:
                UnOp::ToInt32
                | UnOp::ToUint32
                | UnOp::Floor
                | UnOp::Ceil
                | UnOp::Trunc
                | UnOp::Round
                | UnOp::Abs,
            ..
        }
        | OpKind::Binary {
            op: BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr,
            ..
        }
        | OpKind::ConstFloat(_)
        | OpKind::BlockParam(_)
        // A length is a `uint32_t` in the header and cannot be anything else:
        // integral by construction, in `[0, 2^32 - 1]` by construction, never
        // NaN. Leaving it out mattered more than it looks -- a comparison joins
        // its two sides into one class, so `i < xs.length` put the counter in a
        // class with the length, and a class is only as good as its worst
        // member. The counter stayed a `double`, every index became an `fptoui`
        // of a floating-point induction variable, and LLVM's scalar evolution
        // cannot model one, so `benches/cases/elementwise` never vectorized.
        | OpKind::Length(_)
        // A code unit proven inside its string is a `uint16`: integral, in
        // range, and not NaN. Leaving it a double drags whatever it is
        // multiplied into and added to along with it, and a loop-carried
        // `int -> double -> int` round trip costs more than everything else in
        // a scan put together. The `checked` case is not this: out of range is
        // NaN, and NaN is not an integer.
        | OpKind::StringUnitAt { checked: false, .. }
        // A call's result, where the callee *was* analyzed. That is now the
        // ordinary case rather than the exception: a function this program
        // defines has its returns in the interprocedural fixpoint, and one of
        // the runtime's own has known results. Where neither applies the facts
        // are TOP and the test below refuses on its own, so this arm does not
        // need to ask which case it is in.
        | OpKind::Call { .. } => true,

        // A field whose *storage* is an integer. `hir::fields` decided that
        // from every store in the program, so the load produces one and there
        // is nothing to convert -- and leaving it out of its class would sink
        // the class, because a class is only as good as its worst member.
        OpKind::FieldGet { .. } => matches!(func.values[id.0 as usize].ty, HirType::Int { .. }),

        // An element whose *storage* is an integer, decided by
        // `hir::elements` from every store in the program. The same rule as a
        // field's and for the same reason: the load already produces one, so
        // there is nothing to convert, and leaving it out of its class would
        // sink the class.
        //
        // Narrowing a *double* element with a conversion at the load was tried
        // and bought nothing -- the conversion costs what the floating-point
        // comparison did.
        OpKind::ArrayGet { .. } => matches!(func.values[id.0 as usize].ty, HirType::Int { .. }),

        // Everything else stays a double, for one of two reasons:
        //
        // - A parameter's representation is the function's ABI, and this pass
        //   does not get to change a signature. `hir::signatures` does, before
        //   this runs.
        // - Integer division is a different function from real division: `7 / 2`
        //   is `3.5` and C would say `3`. The analysis only proves a quotient
        //   whole when it is exact, but the margin is not worth what it buys.
        _ => false,
    };

    if !usable {
        return None;
    }

    if integral(id, I32_MIN, I32_MAX) {
        Some(32)
    } else if integral(id, facts::SAFE_MIN, facts::SAFE_MAX) {
        // Past 2^53 an `f64` cannot tell adjacent integers apart, so there is
        // nothing to prove and nothing to represent.
        Some(64)
    } else {
        None
    }
}

/// Add the conversions the new types require, and count them.
/// Make every store agree with the slot it writes into.
///
/// Specialization narrows a *slot* and the *value* that fills it independently,
/// and nothing put them back together. A field narrowed to `i32` was assigned a
/// `double`; an array of `double` was assigned an `i32`. The IR permitted it
/// because `verify::compatible` called any scalar compatible with any other,
/// and that rule existed because **C converts at an assignment and says
/// nothing** -- so the only backend that ever saw the mismatch was the one that
/// had to write the conversion down.
///
/// It is not a harmless untidiness. The LLVM backend chose the element type
/// from the stored value and emitted `store i64` into an array of doubles: the
/// same eight bytes, so nothing crashed, and every later read of that element
/// was an integer's bits read as a double. `erasure-stored-typed` answered
/// 1.3186118021857029e-314 where node answered 2668900000.
///
/// So the conversion belongs here, once, where both backends inherit it --
/// rather than in each backend, differently, where one of them can get it
/// wrong. `insert_conversions` next door does exactly this for operands,
/// arguments and returns; these are the three slots it did not cover.
pub fn reconcile_stores<S: std::hash::BuildHasher>(
    func: &mut Func,
    layouts: &[super::Layout],
    globals: &[super::Global],
    returns: &std::collections::HashMap<String, HirType, S>,
) -> usize {
    let mut blocks = std::mem::take(&mut func.blocks);
    let mut count = 0;

    for block in &mut blocks {
        let mut rewritten = Vec::with_capacity(block.ops.len());
        for &value in &block.ops {
            let kind = func.values[value.0 as usize].kind.clone();
            let produced = func.values[value.0 as usize].ty.clone();
            let updated = match kind {
                // Both operands of an operator at one type, which C picks for
                // itself with its usual arithmetic conversions and never
                // mentions. The LLVM backend had to name a type for the
                // instruction, so it grew a copy of those rules -- C's
                // semantics living in a backend that should not know them.
                // Deciding it here means both backends read the same answer.
                OpKind::Binary { op: bin, lhs, rhs }
                    if !matches!(bin, BinOp::Eq | BinOp::Ne | BinOp::Concat)
                        && func.values[lhs.0 as usize].ty != HirType::Erased
                        && func.values[rhs.0 as usize].ty != HirType::Erased =>
                {
                    let left = func.values[lhs.0 as usize].ty.clone();
                    let right = func.values[rhs.0 as usize].ty.clone();
                    // A comparison answers a bool whatever it compared, so the
                    // type the two meet at is theirs to decide; everything else
                    // works in the type of its own result.
                    let joint = if bin.is_comparison() {
                        usual_conversion(&left, &right)
                    } else {
                        produced
                    };
                    let lhs = convert(func, &mut rewritten, &mut count, lhs, &joint);
                    let rhs = convert(func, &mut rewritten, &mut count, rhs, &joint);
                    Some(OpKind::Binary { op: bin, lhs, rhs })
                }
                OpKind::Call {
                    callee: super::Callee::External(target),
                    args,
                    frame,
                } => runtime_arguments(func, &mut rewritten, &mut count, &target, &args, frame),
                // A number goes into an erased value as a `double`, because
                // that is what the payload holds -- the union's first member,
                // and the thing every reader of a `NTS_TAG_NUMBER` takes back
                // out. An integer reaching here was converted by whichever
                // backend was looking: C at the call to
                // `nts_value_of_number(double)`, LLVM with an explicit
                // `sitofp` in `payload_from`. It is one fact about the tag
                // contract, so it belongs where the contract is.
                OpKind::Erase { value: erased }
                    if matches!(func.values[erased.0 as usize].ty, HirType::Int { .. }) =>
                {
                    let want = HirType::Float { bits: 64 };
                    let erased = convert(func, &mut rewritten, &mut count, erased, &want);
                    Some(OpKind::Erase { value: erased })
                }
                OpKind::ArraySet {
                    array,
                    index,
                    value: stored,
                    checked,
                } => match &func.values[array.0 as usize].ty {
                    HirType::Managed(super::ManagedType::Array(element)) => {
                        let want = (**element).clone();
                        let stored = convert(func, &mut rewritten, &mut count, stored, &want);
                        Some(OpKind::ArraySet {
                            array,
                            index,
                            value: stored,
                            checked,
                        })
                    }
                    _ => None,
                },
                OpKind::GlobalSet {
                    global,
                    value: stored,
                } => globals.get(global as usize).map(|slot| {
                    let want = slot.ty.clone();
                    let stored = convert(func, &mut rewritten, &mut count, stored, &want);
                    OpKind::GlobalSet {
                        global,
                        value: stored,
                    }
                }),
                OpKind::FieldSet {
                    object,
                    field,
                    value: stored,
                } => {
                    let want = match &func.values[object.0 as usize].ty {
                        HirType::Managed(super::ManagedType::Object(ty)) => layouts
                            .iter()
                            .find(|layout| layout.types.contains(ty))
                            .and_then(|layout| layout.fields.get(field as usize))
                            .map(|slot| slot.ty.clone()),
                        _ => None,
                    };
                    want.map(|want| {
                        let stored = convert(func, &mut rewritten, &mut count, stored, &want);
                        OpKind::FieldSet {
                            object,
                            field,
                            value: stored,
                        }
                    })
                }
                _ => None,
            };
            if let Some(kind) = updated {
                func.values[value.0 as usize].kind = kind;
            }
            rewritten.push(value);
        }
        block.ops = rewritten;
    }

    func.blocks = blocks;
    count + reconcile_edges(func) + reconcile_call_results(func, returns)
}

/// The arguments to a C runtime call, at the types C declares.
///
/// The signature is external and fixed -- `nts_array_new` takes a `double`
/// length whatever specialization narrowed ours to -- so the conversion is
/// forced rather than chosen. Forced or not, writing it in each backend is
/// writing it twice, and the two can be written differently.
fn runtime_arguments(
    func: &mut Func,
    rewritten: &mut Vec<ValueId>,
    count: &mut usize,
    target: &str,
    args: &[ValueId],
    frame: Option<u32>,
) -> Option<OpKind> {
    // A frame-placed call goes to the `_into` form, whose first parameter is
    // the storage, so every later index shifts by one.
    let (name, shift) = match frame {
        Some(_) => (super::runtime::into_form(target), 1),
        None => (target.to_owned(), 0),
    };
    let declared = super::runtime::parameters(&name)?;
    let args = args
        .iter()
        .enumerate()
        .map(|(at, arg)| match declared.get(at + shift) {
            Some(Some(want)) => convert(func, rewritten, count, *arg, want),
            _ => *arg,
        })
        .collect();
    Some(OpKind::Call {
        callee: super::Callee::External(target.to_owned()),
        args,
        frame,
    })
}

/// The one type two operands of an operator meet at.
///
/// C's usual arithmetic conversions, because C is the oracle and this is what
/// it does silently at every mixed-type comparison: a `double` on either side
/// wins, then `bigint`, then the wider integer -- and at equal width the
/// unsigned one, which is C's rule rather than an arbitrary tiebreak. A `bool`
/// never wins, because it promotes.
///
/// This lived in the LLVM backend, which is the wrong place for it twice over:
/// it is a decision about what a program *means*, and a backend that makes it
/// is a backend the other one can disagree with.
fn usual_conversion(left: &HirType, right: &HirType) -> HirType {
    if left == right {
        return left.clone();
    }
    match (left, right) {
        (HirType::Float { bits: a }, HirType::Float { bits: b }) => {
            HirType::Float { bits: *a.max(b) }
        }
        (HirType::Float { .. }, _) => left.clone(),
        (_, HirType::Float { .. }) => right.clone(),
        (HirType::BigInt, _) | (_, HirType::BigInt) => HirType::BigInt,
        (
            HirType::Int {
                bits: a,
                signed: left_signed,
            },
            HirType::Int {
                bits: b,
                signed: right_signed,
            },
        ) => HirType::Int {
            bits: *a.max(b),
            signed: match a.cmp(b) {
                std::cmp::Ordering::Equal => *left_signed && *right_signed,
                std::cmp::Ordering::Greater => *left_signed,
                std::cmp::Ordering::Less => *right_signed,
            },
        },
        (HirType::Bool, other) | (other, HirType::Bool) => other.clone(),
        _ => left.clone(),
    }
}

/// Make a direct call's result the type the function it names returns.
///
/// The call keeps the callee's type and a `Convert` narrows it, which is the
/// explicit form of what the call site used to assert on its own. Unchecked
/// until a closure came out fourteen times slower through LLVM than through C:
/// `Closure0__call` was defined returning `double` and called expecting `i32`,
/// because the definition read the callee and the call site read the operation.
///
/// LLVM verified that -- with opaque pointers a call carries its own signature
/// and may disagree with its callee -- and then could not inline a call whose
/// signature disagrees, so a one-line arrow function stayed a real call in the
/// innermost loop. C converts at the assignment and never had to notice.
fn reconcile_call_results<S: std::hash::BuildHasher>(
    func: &mut Func,
    returns: &std::collections::HashMap<String, HirType, S>,
) -> usize {
    let disagreeing: Vec<(ValueId, HirType)> = func
        .values
        .iter()
        .enumerate()
        .filter_map(|(at, op)| {
            let declared = match &op.kind {
                OpKind::Call {
                    callee: super::Callee::Direct(name),
                    ..
                } => returns.get(name)?.clone(),
                // The runtime's return, for the same reason as its parameters:
                // `nts_math_pow` returns a `double` into an operation carrying
                // `bigint`, and C converted that at the assignment silently.
                OpKind::Call {
                    callee: super::Callee::External(name),
                    frame,
                    ..
                } => {
                    let name = match frame {
                        Some(_) => super::runtime::into_form(name),
                        None => name.clone(),
                    };
                    super::runtime::result(&name)?.clone()
                }
                _ => return None,
            };
            let declared = &declared;
            // Two references are two pointers however their types relate, so
            // there is nothing between them to convert -- and manufacturing a
            // value for the upcast would give one object two SSA names, which
            // every pass that follows a reference would then see as two
            // objects. `convert` says the same thing next door; this path did
            // not, and `ref(): this` became a `Convert` from one class to
            // another that the C backend could only refuse.
            if declared.is_managed() && op.ty.is_managed() {
                return None;
            }
            (*declared != op.ty).then(|| {
                (
                    ValueId(u32::try_from(at).unwrap_or(u32::MAX)),
                    declared.clone(),
                )
            })
        })
        .collect();

    let mut count = 0;
    for (call, declared) in disagreeing {
        let produced = func.values[call.0 as usize].ty.clone();
        let origin = func.values[call.0 as usize].origin.clone();
        let narrowed = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));

        // Every reader moves to the conversion -- done *before* the conversion
        // exists, so its own operand is not rewritten to itself.
        for op in &mut func.values {
            super::simplify::substitute(&mut op.kind, |v| if v == call { narrowed } else { v });
        }
        for block in &mut func.blocks {
            super::simplify::substitute_terminator(&mut block.terminator, |v| {
                if v == call { narrowed } else { v }
            });
        }

        func.values.push(Op {
            kind: OpKind::Convert(call),
            ty: produced,
            origin,
        });
        func.values[call.0 as usize].ty = declared;
        for block in &mut func.blocks {
            if let Some(at) = block.ops.iter().position(|&v| v == call) {
                block.ops.insert(at + 1, narrowed);
                break;
            }
        }
        count += 1;
    }
    count
}

/// Make every jump hand a block parameter the type it declares.
///
/// A block parameter is where two paths agree about what a name holds, so a
/// mismatch is the two paths disagreeing. The conversion has to happen in the
/// *predecessor*, because that is the only place both the value and the branch
/// exist -- a phi's incoming value must be available in the block it comes
/// from, which is a rule about LLVM and a rule about meaning.
///
/// `specialize` already unions a parameter with every argument feeding it, so
/// what reaches here is the few that union could not settle: three across the
/// whole example corpus, all of them an `i32` arriving where an `f64` was
/// declared.
fn reconcile_edges(func: &mut Func) -> usize {
    let mut blocks = std::mem::take(&mut func.blocks);
    let mut count = 0;
    let wanted: Vec<Vec<HirType>> = blocks
        .iter()
        .map(|block| {
            block
                .params
                .iter()
                .map(|param| func.values[param.0 as usize].ty.clone())
                .collect()
        })
        .collect();
    for block in &mut blocks {
        let mut rewritten = std::mem::take(&mut block.ops);
        let mut fit = |func: &mut Func, target: super::BlockId, args: &mut Vec<ValueId>| {
            for (at, arg) in args.iter_mut().enumerate() {
                let Some(want) = wanted[target.0 as usize].get(at) else {
                    continue;
                };
                *arg = convert(func, &mut rewritten, &mut count, *arg, want);
            }
        };
        let mut terminator = std::mem::replace(&mut block.terminator, super::Terminator::Unreachable);
        match &mut terminator {
            super::Terminator::Jump { target, args } => fit(func, *target, args),
            super::Terminator::Branch {
                then_target,
                then_args,
                else_target,
                else_args,
                ..
            } => {
                fit(func, *then_target, then_args);
                fit(func, *else_target, else_args);
            }
            _ => {}
        }
        block.terminator = terminator;
        block.ops = rewritten;
    }

    func.blocks = blocks;
    count
}

fn insert_conversions(
    func: &mut Func,
    analysis: &Analysis,
    expected: &super::signatures::Expected,
) -> usize {
    let mut blocks = std::mem::take(&mut func.blocks);
    let return_type = func.return_type.clone();
    let mut count = 0;

    for block in &mut blocks {
        let mut rewritten = Vec::with_capacity(block.ops.len());

        for &value in &block.ops {
            let mut coerce = |func: &mut Func, operand: ValueId, wanted: &HirType| {
                convert(func, &mut rewritten, &mut count, operand, wanted)
            };

            let kind = func.values[value.0 as usize].kind.clone();
            let ty = func.values[value.0 as usize].ty.clone();
            let updated = match kind {
                // An erased operand is left exactly as it is. `comparison_type`
                // falls back to comparing in doubles, on the argument that every
                // integer this pass produces is exact as an `f64` -- which is
                // sound for numbers and false for a value that is not one. The
                // conversion it asked for emitted `(double)v` on a sixteen-byte
                // struct: uncompilable C, from `x === 5` on a `number |
                // undefined`, in a function the lowering called complete.
                //
                // The emitter compares these by testing the tag first, and that
                // needs both sides as they are.
                OpKind::Binary { op: bin, lhs, rhs }
                    if bin.is_comparison()
                        && (func.values[lhs.0 as usize].ty == HirType::Erased
                            || func.values[rhs.0 as usize].ty == HirType::Erased) =>
                {
                    None
                }
                OpKind::Binary { op: bin, lhs, rhs } if bin.is_comparison() => {
                    // A comparison's operands must agree with each other rather
                    // than with its result, which is a bool either way.
                    let wanted = comparison_type(func, analysis, lhs, rhs);
                    let lhs = coerce(func, lhs, &wanted);
                    let rhs = coerce(func, rhs, &wanted);
                    Some(OpKind::Binary { op: bin, lhs, rhs })
                }
                OpKind::Binary { op: bin, lhs, rhs } => {
                    let lhs = coerce(func, lhs, &ty);
                    let rhs = coerce(func, rhs, &ty);
                    Some(OpKind::Binary { op: bin, lhs, rhs })
                }
                // A converting operation's operand must be left exactly as it
                // is. These *are* the conversion, and coercing the input first
                // changes the answer: `floor(-3.7)` is `-4`, while truncating
                // `-3.7` to an integer first gives `-3` and then floors to `-3`.
                // For `ToInt32` the same coercion is undefined behaviour
                // outright, on precisely the values it exists to handle. For
                // `Truthy` it is `(bool)x`, which calls NaN true.
                OpKind::Unary {
                    op:
                        op @ (UnOp::ToInt32
                        | UnOp::ToUint32
                        | UnOp::Floor
                        | UnOp::Ceil
                        | UnOp::Trunc
                        | UnOp::Round
                        | UnOp::Abs
                        | UnOp::Truthy),
                    operand,
                } => Some(OpKind::Unary { op, operand }),
                OpKind::Unary { op, operand } => {
                    let operand = coerce(func, operand, &ty);
                    Some(OpKind::Unary { op, operand })
                }
                OpKind::Call {
                    callee,
                    args,
                    frame,
                } => {
                    // What the callee says it takes. `hir::signatures` may have
                    // narrowed a parameter to an integer, in which case the
                    // argument is converted to *that* rather than widened back
                    // to a double -- and it is sound to do so, because that
                    // narrowing was decided from the facts at this very call.
                    //
                    // A callee this compilation does not define takes a
                    // `number` as a double, because that is the ABI a
                    // declaration promises. A managed reference crosses as
                    // itself either way: it has one representation, and
                    // coercing it to a double would be a cast from a pointer
                    // rather than a conversion.
                    let wanted = match &callee {
                        Callee::Direct(name) => expected.get(name),
                        _ => None,
                    };
                    let args = args
                        .into_iter()
                        .enumerate()
                        .map(|(at, arg)| {
                            let target = wanted.and_then(|params| params.get(at));
                            match target {
                                Some(ty @ HirType::Int { .. }) => coerce(func, arg, ty),
                                _ if matches!(
                                    func.values[arg.0 as usize].ty,
                                    HirType::Int { .. }
                                ) =>
                                {
                                    coerce(func, arg, &HirType::NUMBER)
                                }
                                _ => arg,
                            }
                        })
                        .collect();
                    Some(OpKind::Call {
                        callee,
                        args,
                        frame,
                    })
                }
                OpKind::Return(Some(operand)) => {
                    let operand = coerce(func, operand, &return_type);
                    Some(OpKind::Return(Some(operand)))
                }
                _ => None,
            };
            if let Some(updated) = updated {
                func.values[value.0 as usize].kind = updated;
            }
            rewritten.push(value);
        }

        // The terminator's operands are evaluated in this block, so anything it
        // needs converting belongs at the end of it.
        if let super::Terminator::Return(Some(operand)) = block.terminator {
            let converted = convert(func, &mut rewritten, &mut count, operand, &return_type);
            block.terminator = super::Terminator::Return(Some(converted));
        }

        block.ops = rewritten;
    }

    func.blocks = blocks;
    count
}

/// The type two operands of a comparison should be brought to.
///
/// Preferring the integer side when the other is *provably* integral matters
/// more than it looks. `for (i = 0; i < limit; i++)` with `limit: 100` compares
/// an `int32` against a `double` every iteration; converting the counter costs
/// a conversion per iteration, while converting the bound costs one that never
/// changes and that the C compiler lifts out of the loop.
fn comparison_type(func: &Func, analysis: &Analysis, lhs: ValueId, rhs: ValueId) -> HirType {
    let left = func.values[lhs.0 as usize].ty.clone();
    let right = func.values[rhs.0 as usize].ty.clone();
    if left == right {
        return left;
    }

    // Narrowing the other side is only allowed if it is provably a whole number
    // already inside that integer's range — otherwise the conversion would
    // change which values compare equal.
    let fits = |value: ValueId, target: &HirType| match target {
        HirType::Int { bits: 32, .. } => analysis.is_integral_within(value, I32_MIN, I32_MAX),
        HirType::Int { .. } => analysis.is_integral_within(value, facts::SAFE_MIN, facts::SAFE_MAX),
        _ => false,
    };
    if matches!(left, HirType::Int { .. }) && fits(rhs, &left) {
        return left;
    }
    if matches!(right, HirType::Int { .. }) && fits(lhs, &right) {
        return right;
    }

    // Otherwise compare in doubles. It is the only choice that cannot be wrong:
    // every integer this pass produces is inside 2^53 and so is exact as an
    // `f64`, while narrowing the other side would not be.
    HirType::NUMBER
}

/// The classes whose integer type can be unsigned.
///
/// # Why it is worth asking, and why only there
///
/// Division and remainder. C's signed forms have to correct for the sign of the
/// dividend, which costs a multiply and two shifts more than the unsigned form
/// — measured at **1.88x** on the `bytes` inner loop, which is two `% 65521`
/// per byte.
///
/// Nothing else is faster unsigned, and a loop counter is *slower*: signed
/// overflow is undefined in C, which is what lets the compiler assume an
/// induction variable never wraps and transform the loop on that basis.
/// Unsigned wraparound is defined, so the same loop has to be preserved as
/// written. `awfy-sieve` has no remainder in it, went unsigned because its
/// bound is a known 5000 and every index is non-negative, and got **26%
/// slower** for it.
///
/// So a class has to contain the operation that pays. The operands are coerced
/// to the operation's type, so making the remainder's own class unsigned is
/// enough to get the unsigned instruction; whatever feeds it keeps its own type
/// and pays one cast, which is what specialization does everywhere else.
///
/// # What has to be true
///
/// Every value in the class non-negative, which is what makes the unsigned
/// reading of its bits the same number.
///
/// And, wherever an operator *interprets* the sign bit, both of its operands
/// non-negative. That is not a refinement of the first rule, it is the whole
/// correctness argument: the operands are coerced to the *operation's* type, so
/// making an operation unsigned can put an unsigned cast on a value from
/// outside the class entirely.
///
/// Leaving that at division cost `for (let i = 0; i < n; i++)` its loop. The
/// counter's class is non-negative; `n` is a parameter and deliberately not
/// joined to it, so it is not in the class and not consulted; and `i < n` with
/// `n` of -1 read as `4294967295` runs four billion times instead of none. The
/// unary case is `Math.abs`, which emits `x < 0 ? -x : x` — with `x` unsigned
/// the test cannot be true, and `Math.abs(-32768)` came back as 4294934528. Its
/// result is legitimately non-negative, which is exactly why its class was
/// eligible and its operand must not have been.
///
/// The operators that do not interpret the sign need no check: `+`, `-`, `*`,
/// `&`, `|`, `^` and `<<` are bit-identical either way, and their result
/// landing in range is exactly the condition under which two's-complement
/// wraparound gives the right answer. `==` and `!=` are bit-identical too and
/// are checked anyway, because they arrive through `is_comparison` and telling
/// them apart would buy nothing.
fn unsigned_classes(
    func: &Func,
    analysis: &Analysis,
    classes: &mut Classes,
    count: usize,
) -> FxHashSet<u32> {
    let non_negative = |value: ValueId| {
        let facts = analysis.get(value);
        !facts.is_bottom() && !facts.maybe_nan && facts.lo >= 0.0 && facts.hi <= facts::U32_MAX
    };

    let mut unsigned: FxHashSet<u32> = FxHashSet::default();
    let mut rejected: FxHashSet<u32> = FxHashSet::default();
    let mut pays: FxHashSet<u32> = FxHashSet::default();
    for index in 0..count {
        let value = ValueId(u32::try_from(index).unwrap_or(0));
        let root = classes.find(value.0);
        if non_negative(value) {
            unsigned.insert(root);
        } else {
            rejected.insert(root);
        }
        // `Math.abs` is the unary case, and the one that reads most like a
        // no-op until it is wrong: it emits `x < 0 ? -x : x`, and with `x`
        // unsigned the test cannot be true. `Math.abs(-32768)` came back as
        // 4294934528. Its *result* is legitimately non-negative, which is
        // exactly why its class was eligible and its operand must not be.
        if let OpKind::Unary {
            op: UnOp::Abs | UnOp::Neg,
            operand,
        } = &func.values[index].kind
            && !non_negative(*operand)
        {
            rejected.insert(root);
            rejected.insert(classes.find(operand.0));
        }
        // `>>>` is unsigned by definition and `<<` is bit-identical, so the
        // sign-sensitive shift is only `>>`.
        if matches!(
            func.values[index].kind,
            OpKind::Binary {
                op: BinOp::Div | BinOp::Rem,
                ..
            }
        ) {
            pays.insert(root);
        }
        if let OpKind::Binary { op, lhs, rhs } = &func.values[index].kind
            && (op.is_comparison() || matches!(op, BinOp::Div | BinOp::Rem | BinOp::Shr))
            && !(non_negative(*lhs) && non_negative(*rhs))
        {
            // All three, because the operands are coerced to the operation's
            // type: leaving either operand's class unsigned would put the cast
            // on the value that cannot survive one.
            rejected.insert(root);
            rejected.insert(classes.find(lhs.0));
            rejected.insert(classes.find(rhs.0));
        }
    }
    unsigned.retain(|root| pays.contains(root) && !rejected.contains(root));
    unsigned
}

/// A value of the wanted type, converting if it is not already.
fn convert(
    func: &mut Func,
    ops: &mut Vec<ValueId>,
    count: &mut usize,
    operand: ValueId,
    wanted: &HirType,
) -> ValueId {
    if func.values[operand.0 as usize].ty == *wanted {
        return operand;
    }
    // A managed reference has one representation, so between two of them there
    // is nothing to convert: a pointer to a derived object *is* a pointer to
    // its base, which is what base-first layout is for. Manufacturing a value
    // for the upcast would give one object two SSA names, and every pass that
    // follows a reference -- escape analysis, reference counting, liveness --
    // would see two objects where there is one. Escape analysis is where that
    // showed: a returned closure looked frame-local, because what the return
    // read was the conversion rather than the allocation.
    //
    // The backend spells the cast at the point of use, which it has to do for
    // call arguments anyway.
    if func.values[operand.0 as usize].ty.is_managed() && wanted.is_managed() {
        return operand;
    }
    let origin = func.values[operand.0 as usize].origin.clone();

    // Converting a constant is a constant. Without this the emitted code says
    // `v7 = 1.0; v10 = (int32_t)v7;` where it means `1` — which any C compiler
    // folds, but which makes the output harder to read than the thing it
    // describes.
    let kind = match (&func.values[operand.0 as usize].kind, wanted) {
        (OpKind::ConstFloat(value), HirType::Int { .. }) =>
        {
            #[allow(clippy::cast_possible_truncation)]
            OpKind::ConstInt(*value as i128)
        }
        #[allow(clippy::cast_precision_loss)]
        (OpKind::ConstInt(value), HirType::Float { .. }) => OpKind::ConstFloat(*value as f64),
        _ => OpKind::Convert(operand),
    };

    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op {
        kind,
        ty: wanted.clone(),
        origin,
    });
    ops.push(id);
    *count += 1;
    id
}

impl BinOp {
    /// Whether this operator produces a bool rather than a number.
    #[must_use]
    pub const fn is_comparison(self) -> bool {
        matches!(
            self,
            Self::Lt | Self::Le | Self::Gt | Self::Ge | Self::Eq | Self::Ne
        )
    }
}
