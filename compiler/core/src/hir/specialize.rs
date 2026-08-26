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

use rustc_hash::FxHashMap;

use super::facts;
use super::flow::Analysis;
use super::{BinOp, Block, Func, HirType, Op, OpKind, UnOp, ValueId};

/// Bounds of the representations this pass will choose.
const I32_MIN: f64 = -2_147_483_648.0;
const I32_MAX: f64 = 2_147_483_647.0;

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
pub fn specialize(func: &mut Func, analysis: &Analysis) -> Report {
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
        {
            classes.union(lhs.0, rhs.0);
        }
    }

    // What each value could be on its own, ignoring the company it keeps.
    let eligible: Vec<Option<u8>> = (0..count)
        .map(|index| width_of(func, analysis, index))
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
    let mut worthwhile: FxHashMap<u32, bool> = FxHashMap::default();
    for (index, value) in func.values.iter().enumerate() {
        let pays = match &value.kind {
            OpKind::Binary { op, .. } => !op.is_comparison(),
            OpKind::Unary { .. } | OpKind::BlockParam(_) => true,
            _ => false,
        };
        if pays {
            let root = classes.find(u32::try_from(index).unwrap_or(0));
            worthwhile.insert(root, true);
        }
    }

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
        func.values[index].ty = HirType::Int { bits, signed: true };
        // A float constant that is provably whole is an integer constant. Left
        // as a float it would be converted back on every use.
        if let OpKind::ConstFloat(value) = func.values[index].kind {
            #[allow(clippy::cast_possible_truncation)]
            let exact = value as i64;
            func.values[index].kind = OpKind::ConstInt(exact);
        }
    }

    report.conversions = insert_conversions(func);
    report
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
        super::Terminator::Return(_) | super::Terminator::Unreachable => Vec::new(),
    }
}

/// The narrowest integer this value is provably within, if any.
fn width_of(func: &Func, analysis: &Analysis, index: usize) -> Option<u8> {
    let id = ValueId(u32::try_from(index).unwrap_or(0));
    if !matches!(func.values[index].ty, HirType::Float { .. }) {
        return None;
    }

    let provable = |value: ValueId| {
        analysis.is_integral_within(value, I32_MIN, I32_MAX)
            || analysis.is_integral_within(value, facts::SAFE_MIN, facts::SAFE_MAX)
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
            op: UnOp::ToInt32 | UnOp::ToUint32,
            ..
        }
        | OpKind::Binary {
            op: BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr,
            ..
        }
        | OpKind::ConstFloat(_)
        | OpKind::BlockParam(_) => true,

        // Everything else stays a double, for one of three reasons:
        //
        // - A parameter's representation is the function's ABI, and this pass
        //   does not get to change a signature. Specializing across call
        //   boundaries is a separate decision with a separate cost.
        // - Integer division is a different function from real division: `7 / 2`
        //   is `3.5` and C would say `3`. The analysis only proves a quotient
        //   whole when it is exact, but the margin is not worth what it buys.
        // - A call's result needs the callee analyzed, and a comparison is not a
        //   number at all.
        _ => false,
    };

    if !usable {
        return None;
    }

    if analysis.is_integral_within(id, I32_MIN, I32_MAX) {
        Some(32)
    } else if analysis.is_integral_within(id, facts::SAFE_MIN, facts::SAFE_MAX) {
        // Past 2^53 an `f64` cannot tell adjacent integers apart, so there is
        // nothing to prove and nothing to represent.
        Some(64)
    } else {
        None
    }
}

/// Add the conversions the new types require, and count them.
fn insert_conversions(func: &mut Func) -> usize {
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
                OpKind::Binary { op: bin, lhs, rhs } if bin.is_comparison() => {
                    // A comparison's operands must agree with each other rather
                    // than with its result, which is a bool either way.
                    let wanted = comparison_type(func, lhs, rhs);
                    let lhs = coerce(func, lhs, &wanted);
                    let rhs = coerce(func, rhs, &wanted);
                    Some(OpKind::Binary { op: bin, lhs, rhs })
                }
                OpKind::Binary { op: bin, lhs, rhs } => {
                    let lhs = coerce(func, lhs, &ty);
                    let rhs = coerce(func, rhs, &ty);
                    Some(OpKind::Binary { op: bin, lhs, rhs })
                }
                // A coercion's operand must be left exactly as it is. Coercing
                // it to the result type would replace `ToInt32` with a C cast —
                // which is undefined behaviour for an out-of-range double, and
                // is precisely what `ToInt32` exists to avoid. The operation is
                // the conversion; it does not need one of its own.
                OpKind::Unary {
                    op: op @ (UnOp::ToInt32 | UnOp::ToUint32),
                    operand,
                } => Some(OpKind::Unary { op, operand }),
                OpKind::Unary { op, operand } => {
                    let operand = coerce(func, operand, &ty);
                    Some(OpKind::Unary { op, operand })
                }
                OpKind::Call { callee, args } => {
                    // Signatures were not specialized, so every argument crosses
                    // as a double.
                    let args = args
                        .into_iter()
                        .map(|arg| coerce(func, arg, &HirType::NUMBER))
                        .collect();
                    Some(OpKind::Call { callee, args })
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

/// Whether two operands of a comparison can be compared as integers.
fn comparison_type(func: &Func, lhs: ValueId, rhs: ValueId) -> HirType {
    let left = &func.values[lhs.0 as usize].ty;
    let right = &func.values[rhs.0 as usize].ty;
    if left == right {
        left.clone()
    } else {
        // Mixed. Comparing in doubles is the only choice that cannot be wrong:
        // every integer this pass produces is inside 2^53 and so is exact as an
        // `f64`, while narrowing the other side would not be.
        HirType::NUMBER
    }
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
    let origin = func.values[operand.0 as usize].origin.clone();

    // Converting a constant is a constant. Without this the emitted code says
    // `v7 = 1.0; v10 = (int32_t)v7;` where it means `1` — which any C compiler
    // folds, but which makes the output harder to read than the thing it
    // describes.
    let kind = match (&func.values[operand.0 as usize].kind, wanted) {
        (OpKind::ConstFloat(value), HirType::Int { .. }) =>
        {
            #[allow(clippy::cast_possible_truncation)]
            OpKind::ConstInt(*value as i64)
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
