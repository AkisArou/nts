//! Testing a root's arguments once, so its body can be integers.
//!
//! # The one thing an exported signature cannot say
//!
//! `export function fib(n: number)` takes a double, because `number` is a
//! double and the ABI is real: the next caller is a linker away. So the whole
//! recursion is floating point — `n - 1`, `n < 2`, the addition — where the C++
//! reference writes `int64_t` and gets integers. That difference is not a
//! missing optimisation, it is a difference in what the two languages let a
//! signature say.
//!
//! What can be recovered is that *almost every actual argument is a whole
//! number*. One test at the boundary settles it:
//!
//! ```text
//! double fib(double n) {
//!     if (nts_to_int32(n) == n) { return fib_whole(n); }   // <- integers inside
//!     return <the original body>;                          // <- NaN, 1e300, 1.5
//! }
//! ```
//!
//! `ToInt32` is total and wraps, so the comparison is exactly the question
//! being asked. A NaN fails it (nothing equals a NaN). An infinity fails it. A
//! fraction fails it. Anything outside `int32` wraps to something else and
//! fails it. What passes is a whole number in range — and then
//! [`super::signatures`] narrows the clone's parameter, because every call site
//! that reaches it now proves one.
//!
//! # Negative zero
//!
//! `ToInt32(-0)` is `0` and `0 == -0` is true, so `-0` would pass the test and
//! arrive at the clone as a zero whose sign is gone. `fib(-0)` returns `-0`,
//! and `1 / fib(-0)` can tell.
//!
//! So where anything in the body can distinguish the two zeros — see
//! [`super::zero_sign`] — the test gains `n != 0`, which is false for *both*
//! zeros and sends them down the slow path with their signs intact. That costs
//! one comparison, and only for a parameter that needs it. Refusing to guard
//! such a function instead would give up on every function that returns its own
//! argument, which is most of the small ones.
//!
//! # What it costs
//!
//! A copy of the body, and one comparison per call from outside. So it is only
//! done where the body *repeats*: a loop or a call to itself. A leaf function
//! called once from outside would pay the copy and save nothing.

use rustc_hash::FxHashSet;

use super::facts::Facts;
use super::{
    BinOp, BlockId, Callee, Func, HirType, Op, OpKind, Terminator, UnOp, ValueId, zero_sign,
};

/// How many roots may be guarded.
///
/// Each costs a copy of its body, so this is a code-size budget. A program with
/// more than a handful of hot exported entry points is not a shape this trade
/// was chosen for.
const GUARD_CAP: usize = 8;

/// Give each qualifying root an integer body behind a test, and report how
/// many.
pub fn install(program: &mut super::Program, roots: &super::reachable::RootNames) -> usize {
    let candidates: Vec<usize> = program
        .funcs
        .iter()
        .enumerate()
        .filter(|(_, func)| roots.contains(&func.name) && worth_guarding(func))
        .map(|(index, _)| index)
        .take(GUARD_CAP)
        .collect();

    let mut made = 0;
    for index in candidates {
        // Which parameters need the extra `!= 0`: the ones whose zero's sign
        // something downstream can distinguish.
        let observed = zero_sign::observed(&program.funcs[index]);
        let clone = clone_for_whole_numbers(&program.funcs[index]);
        let name = clone.name.clone();
        program.funcs.push(clone);
        rewrite_as_guard(&mut program.funcs[index], &name, &observed);
        made += 1;
    }
    made
}

/// Undo a guard whose copy turned out to gain nothing.
///
/// Whether the test pays cannot be known before the analysis runs: it pays
/// exactly when [`super::signatures`] can narrow the copy's signature with what
/// the test established. So the guard is installed first and taken out again
/// here, where the answer is a fact rather than a guess.
///
/// Taking it out is one edge: the original body is still there, as the path the
/// test rejects, so the entry jumps straight to it. The test's operations and
/// the copy are then unreachable, and the passes that remove unreachable things
/// remove them.
pub fn retract(program: &mut super::Program) -> usize {
    let unchanged: Vec<String> = program
        .funcs
        .iter()
        .filter_map(|clone| {
            let original = clone.name.strip_suffix("#whole")?;
            let source = program.funcs.iter().find(|func| func.name == original)?;
            // The copy exists to have a narrower signature. If it does not, it
            // is a copy.
            let narrowed = clone
                .params
                .iter()
                .zip(&source.params)
                .any(|(mine, theirs)| mine.ty != theirs.ty)
                || clone.return_type != source.return_type;
            (!narrowed).then(|| original.to_owned())
        })
        .collect();

    for name in &unchanged {
        let Some(func) = program.funcs.iter_mut().find(|func| func.name == *name) else {
            continue;
        };
        // The block the test falls through to when it fails, which is the
        // original body's entry: the last thing `rewrite_as_guard` pushed
        // before the fast path and the tests.
        let Some(Terminator::Branch { else_target, .. }) =
            func.blocks.first().map(|b| &b.terminator)
        else {
            continue;
        };
        let slow = *else_target;
        let parameters = func.blocks[0].ops.clone();
        func.blocks[0].ops = parameters
            .into_iter()
            .filter(|value| matches!(func.values[value.0 as usize].kind, OpKind::Param(_)))
            .collect();
        func.blocks[0].terminator = Terminator::Jump {
            target: slow,
            args: Vec::new(),
        };
    }
    unchanged.len()
}

/// Whether a body runs often enough to amortise a test and a copy.
///
/// A back edge or a call to itself. Both mean the body is entered many times
/// per call from outside, which is when one comparison at the boundary is
/// nothing and floating-point arithmetic inside is everything.
fn worth_guarding(func: &Func) -> bool {
    if func
        .params
        .iter()
        .all(|param| !matches!(param.ty, HirType::Float { .. }))
    {
        return false;
    }
    let recurses = func.values.iter().any(|op| {
        matches!(&op.kind, OpKind::Call { callee: Callee::Direct(name), .. } if *name == func.name)
    });
    let loops = func
        .blocks
        .iter()
        .enumerate()
        .any(|(at, block)| match &block.terminator {
            Terminator::Jump { target, .. } => target.0 as usize <= at,
            Terminator::Branch {
                then_target,
                else_target,
                ..
            } => then_target.0 as usize <= at || else_target.0 as usize <= at,
            Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => false,
        });
    recurses || loops
}

/// A copy of a function whose float parameters are the whole numbers only.
///
/// The copy's *types* do not change here. What changes is who calls it: only
/// the guard, with values it has just proved whole, and itself. That is what
/// lets [`super::signatures`] narrow the parameters afterwards, by the ordinary
/// rule and with no special case for having been cloned.
fn clone_for_whole_numbers(func: &Func) -> Func {
    let mut clone = func.clone();
    clone.name = format!("{}#whole", func.name);
    // Not exported: it exists because the guard calls it, and reachability
    // keeps it for exactly that reason.
    clone.exported = false;
    // A call to itself is a call to the copy. Re-entering through the guard
    // would test a value the guard has already tested, once per level.
    for op in &mut clone.values {
        if let OpKind::Call {
            callee: Callee::Direct(name),
            ..
        } = &mut op.kind
            && *name == func.name
        {
            name.clone_from(&clone.name);
        }
    }
    clone
}

/// Replace a function's body with the test, keeping the original as the path
/// for everything the test rejects.
///
/// The original entry block's contents move to a block of their own and block
/// zero becomes the test, so nothing is renumbered — a `BlockId` is an index,
/// and shifting them would mean rewriting every terminator in the function.
fn rewrite_as_guard(func: &mut Func, whole: &str, observed: &FxHashSet<ValueId>) {
    let origin = func.origin.clone();
    let mut entry = std::mem::replace(
        &mut func.blocks[0],
        super::Block {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: Terminator::Unreachable,
        },
    );
    // A parameter is defined at the function's entry, so its operation belongs
    // to whatever block zero is. Moving it out with the rest of the body would
    // leave the test reading a value defined after it -- which the verifier
    // says, in those words.
    let parameters: Vec<ValueId> = entry
        .ops
        .iter()
        .copied()
        .filter(|value| matches!(func.values[value.0 as usize].kind, OpKind::Param(_)))
        .collect();
    entry
        .ops
        .retain(|value| !matches!(func.values[value.0 as usize].kind, OpKind::Param(_)));

    let slow = BlockId(u32::try_from(func.blocks.len()).unwrap_or(0));
    func.blocks.push(entry);
    // Nothing in this lowering jumps to the entry block -- a loop header is
    // always a block of its own -- but a jump that did would now mean the test.
    for block in &mut func.blocks {
        retarget(&mut block.terminator, BlockId(0), slow);
    }

    // One test block per float parameter, each falling through to the next and
    // out to the slow path. The fast path is reached only when every one holds.
    let guarded: Vec<u32> = (0..func.params.len())
        .filter(|slot| matches!(func.params[*slot].ty, HirType::Float { .. }))
        .map(|slot| u32::try_from(slot).unwrap_or(u32::MAX))
        .collect();

    let (tests, handed) = build_tests(func, &guarded, observed);

    let call = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op {
        kind: OpKind::Call {
            callee: Callee::Direct(whole.to_owned()),
            args: handed,
            frame: None,
        },
        ty: func.return_type.clone(),
        origin,
    });

    // The fast path: hand the same values over and return what comes back. The
    // *conversion* to an integer is not spelled here -- `hir::signatures`
    // narrows the clone's parameters and `specialize` inserts the casts, by the
    // same rule it uses for every other call.
    let fast = BlockId(u32::try_from(func.blocks.len()).unwrap_or(0));
    func.blocks.push(super::Block {
        params: Vec::new(),
        ops: vec![call],
        terminator: if matches!(func.return_type, HirType::Void) {
            Terminator::Return(None)
        } else {
            Terminator::Return(Some(call))
        },
    });

    // The chain of tests, laid out backwards so each knows where it goes next.
    let mut next = fast;
    for (at, (ops, cond)) in tests.iter().enumerate().rev() {
        let block = super::Block {
            params: Vec::new(),
            ops: ops.clone(),
            terminator: Terminator::Branch {
                cond: *cond,
                then_target: next,
                then_args: Vec::new(),
                else_target: slow,
                else_args: Vec::new(),
            },
        };
        if at == 0 {
            let mut block = block;
            // The parameters are defined here, before the first thing that
            // reads one.
            let mut ops = parameters.clone();
            ops.append(&mut block.ops);
            block.ops = ops;
            func.blocks[0] = block;
        } else {
            next = BlockId(u32::try_from(func.blocks.len()).unwrap_or(0));
            func.blocks.push(block);
        }
    }

    // Every parameter of the guard is now read by the test rather than by the
    // body, and the body's copy reads its own.
    func.params
        .iter_mut()
        .for_each(|param| param.known = Facts::TOP);
}

/// One test per float parameter, and what the fast path hands over.
///
/// The value handed over is the *truncated* one, not the original: on this path
/// they are the same number -- that is what the test just established -- and
/// only one of them is provably a whole `int32`, which is the fact
/// [`super::signatures`] needs to narrow the clone's parameter.
fn build_tests(
    func: &mut Func,
    guarded: &[u32],
    observed: &FxHashSet<ValueId>,
) -> (Vec<(Vec<ValueId>, ValueId)>, Vec<ValueId>) {
    let origin = func.origin.clone();
    let push = |values: &mut Vec<Op>, kind: OpKind, ty: HirType| {
        let id = ValueId(u32::try_from(values.len()).unwrap_or(u32::MAX));
        values.push(Op {
            kind,
            ty,
            origin: origin.clone(),
        });
        id
    };
    let mut tests: Vec<(Vec<ValueId>, ValueId)> = Vec::new();
    let mut handed: Vec<ValueId> = (0..func.params.len())
        .map(|slot| ValueId(u32::try_from(slot).unwrap_or(u32::MAX)))
        .collect();

    for slot in guarded {
        let param = ValueId(*slot);
        let truncated = push(
            &mut func.values,
            OpKind::Unary {
                op: UnOp::ToInt32,
                operand: param,
            },
            HirType::NUMBER,
        );
        let same = push(
            &mut func.values,
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: truncated,
                rhs: param,
            },
            HirType::Bool,
        );
        tests.push((vec![truncated, same], same));
        handed[*slot as usize] = truncated;

        // `-0` passes `ToInt32(n) == n`, so where the sign can be seen both
        // zeros go the slow way. A separate block rather than a conjunction:
        // the IR has no boolean `and`, and short-circuiting is what a branch is.
        if observed.contains(&param) {
            let zero = push(&mut func.values, OpKind::ConstFloat(0.0), HirType::NUMBER);
            let nonzero = push(
                &mut func.values,
                OpKind::Binary {
                    op: BinOp::Ne,
                    lhs: param,
                    rhs: zero,
                },
                HirType::Bool,
            );
            tests.push((vec![zero, nonzero], nonzero));
        }
    }
    (tests, handed)
}

/// Point a terminator at a different block, where it pointed at `from`.
fn retarget(terminator: &mut Terminator, from: BlockId, to: BlockId) {
    match terminator {
        Terminator::Jump { target, .. } => {
            if *target == from {
                *target = to;
            }
        }
        Terminator::Branch {
            then_target,
            else_target,
            ..
        } => {
            if *then_target == from {
                *then_target = to;
            }
            if *else_target == from {
                *else_target = to;
            }
        }
        Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => {}
    }
}
