//! A body past the class file's method-size limit, split into helpers.
//!
//! JVMS caps a method at 65,534 bytes of code. C, LLVM and Wasm have no such
//! limit, so this is the JVM's alone: a module-scope literal of 2048 records
//! is one block of about 14,000 operations, and its `module#init` came out at
//! 94,835 bytes and was declined (NTS4001). test262's
//! `Array/prototype/sort/stability-2048-elements.js` is that shape, and so is
//! any generated table.
//!
//! The rewrite is HIR to HIR and asked for only on that failure: the emitter
//! renders every function as before, and a function whose body comes out too
//! long is handed to [`split_for_method_limit`], which moves straight-line runs
//! of its operations into helper functions. Each helper is an ordinary HIR
//! function -- parameters, one block, a return -- so typing, frames and
//! verification are the emitter's existing ones, and nothing about a function
//! that fits changes.
//!
//! # What moves
//!
//! A run is consecutive operations of one block, so no control flow enters or
//! leaves it. Every operation in it is [`movable`]: it reads only its operands
//! and writes only what every function shares (objects, arrays, module
//! globals), and it cannot raise -- a raise is a call followed by the caller's
//! `nts_raising` test, and a call never moves. The values the run reads from
//! before it become the helper's parameters; at most one value it defines may
//! be read after it, and that one is the helper's result, keeping its
//! [`ValueId`] in the caller so every later read is unchanged. A stretch with
//! no cut that leaves one value live is not split, and the decline stays.

use nts_core::hir::{
    Block, Callee, Func, HirType, Op, OpKind, Param, ParamShape, Terminator, ValueId,
};
use rustc_hash::{FxHashMap, FxHashSet};
use std::cell::RefCell;

/// The most values a helper takes as parameters. The JVM allows 255 slots of
/// them and a `double` takes two; this leaves room and keeps a call cheap.
const MAX_LIVE_INS: usize = 32;

/// The shortest run worth a call.
const MIN_RUN: usize = 16;

/// The name a helper's HIR function carries: `#` is no character a
/// TypeScript name can hold, as in `module#init`. Its JVM spelling can still
/// meet a declared name (`#` and `$` are both spelled `$`), so the caller says
/// which spellings are taken and [`split_for_method_limit`] skips them.
#[must_use]
pub fn helper_name(func: &str, k: usize) -> String {
    format!("{func}#split{k}")
}

/// Whether an operation may move into a helper. An allowlist: an operation
/// added to the IR stays where it is until someone decides it can move.
#[must_use]
pub fn movable(kind: &OpKind) -> bool {
    matches!(
        kind,
        OpKind::ConstInt(_)
            | OpKind::ConstFloat(_)
            | OpKind::ConstBool(_)
            | OpKind::ConstString(_)
            | OpKind::ConstNull
            | OpKind::ConstUndefined
            | OpKind::Erase { .. }
            | OpKind::TagOf { .. }
            | OpKind::Unerase { .. }
            | OpKind::Binary { .. }
            | OpKind::Unary { .. }
            | OpKind::Convert(_)
            | OpKind::ArrayNew { .. }
            | OpKind::Length(_)
            | OpKind::ArrayGet { .. }
            | OpKind::ArraySet { .. }
            | OpKind::ObjectNew { .. }
            | OpKind::FieldGet { .. }
            | OpKind::FieldSet { .. }
            | OpKind::GlobalGet(_)
            | OpKind::GlobalSet { .. }
            | OpKind::StringUnitAt { .. }
            | OpKind::InstanceOf { .. }
    )
}

/// The values an operation reads, by the same visitor that renumbers them, so
/// the parameters a helper takes and the operands it rewrites cannot disagree.
fn reads(kind: &OpKind) -> Vec<ValueId> {
    let seen = RefCell::new(Vec::new());
    let mut copy = kind.clone();
    nts_core::hir::simplify::substitute(&mut copy, |value| {
        seen.borrow_mut().push(value);
        value
    });
    seen.into_inner()
}

/// Where a value of one block is last read: at an operation of that block,
/// or beyond its operations (its terminator, another block, the function).
#[derive(Clone, Copy, PartialEq, Eq)]
enum LastRead {
    Never,
    At(usize),
    Beyond,
}

fn last_reads(func: &Func, block: usize) -> FxHashMap<ValueId, LastRead> {
    let mut last: FxHashMap<ValueId, LastRead> = FxHashMap::default();
    let mut read = |value: ValueId, at: LastRead| {
        let entry = last.entry(value).or_insert(LastRead::Never);
        *entry = match (*entry, at) {
            (LastRead::Beyond, _) | (_, LastRead::Beyond) => LastRead::Beyond,
            (LastRead::At(a), LastRead::At(b)) => LastRead::At(a.max(b)),
            (_, other) => other,
        };
    };
    for (at, b) in func.blocks.iter().enumerate() {
        for (position, &value) in b.ops.iter().enumerate() {
            let here = if at == block {
                LastRead::At(position)
            } else {
                LastRead::Beyond
            };
            for operand in reads(&func.values[value.0 as usize].kind) {
                read(operand, here);
            }
        }
        for operand in nts_core::hir::operands_of_terminator(&b.terminator) {
            read(operand, LastRead::Beyond);
        }
    }
    if let Some(result) = func.async_result {
        read(result, LastRead::Beyond);
    }
    last
}

/// A run's boundary: what it reads from before it, and the one value it
/// defines that is read after it, if any.
struct Cut {
    live_ins: Vec<ValueId>,
    live_out: Option<ValueId>,
}

fn cut(
    ops: &[ValueId],
    reads_of: &[Vec<ValueId>],
    last: &FxHashMap<ValueId, LastRead>,
    end: usize,
) -> Option<Cut> {
    let inside: FxHashSet<ValueId> = ops.iter().copied().collect();
    let mut live_out = None;
    for &value in ops {
        let read_after = match last.get(&value).copied().unwrap_or(LastRead::Never) {
            LastRead::Never => false,
            LastRead::At(position) => position >= end,
            LastRead::Beyond => true,
        };
        if read_after {
            if live_out.is_some() {
                return None;
            }
            live_out = Some(value);
        }
    }
    let mut live_ins = Vec::new();
    let mut taken = FxHashSet::default();
    for operands in reads_of {
        for &operand in operands {
            if !inside.contains(&operand) && taken.insert(operand) {
                live_ins.push(operand);
            }
        }
    }
    (live_ins.len() <= MAX_LIVE_INS).then_some(Cut { live_ins, live_out })
}

/// The runs to move out of one block, as `(start, end)` positions in its
/// operations, each at most `budget` long and each with a valid [`Cut`].
fn runs(func: &Func, block: usize, budget: usize) -> Vec<(usize, usize, Cut)> {
    let ops = &func.blocks[block].ops;
    let last = last_reads(func, block);
    let reads_of: Vec<Vec<ValueId>> = ops
        .iter()
        .map(|value| reads(&func.values[value.0 as usize].kind))
        .collect();
    let movable_at = |at: usize| movable(&func.values[ops[at].0 as usize].kind);
    let mut found = Vec::new();
    let mut at = 0;
    while at < ops.len() {
        if !movable_at(at) {
            at += 1;
            continue;
        }
        let mut stretch_end = at;
        while stretch_end < ops.len() && movable_at(stretch_end) {
            stretch_end += 1;
        }
        let mut start = at;
        while stretch_end - start >= MIN_RUN {
            let mut end = (start + budget).min(stretch_end);
            let chosen = loop {
                if let Some(boundary) = cut(&ops[start..end], &reads_of[start..end], &last, end) {
                    break Some(boundary);
                }
                end -= 1;
                if end - start < MIN_RUN {
                    break None;
                }
            };
            match chosen {
                Some(boundary) => {
                    found.push((start, end, boundary));
                    start = end;
                }
                // No cut from here leaves one value live: step past the
                // operation that starts the stretch and try again after it.
                None => start += 1,
            }
        }
        at = stretch_end;
    }
    found
}

/// The helper a run becomes: its live-ins as parameters, the run's
/// operations renumbered, and its live-out returned.
fn helper(func: &Func, name: String, run: &[ValueId], boundary: &Cut) -> Func {
    let mut values: Vec<Op> = Vec::with_capacity(boundary.live_ins.len() + run.len());
    let mut renumbered: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    let mut params = Vec::with_capacity(boundary.live_ins.len());
    let mut ops = Vec::with_capacity(values.capacity());
    for (index, &value) in boundary.live_ins.iter().enumerate() {
        let defined = &func.values[value.0 as usize];
        params.push(Param {
            name: format!("in{index}"),
            ty: defined.ty.clone(),
            origin: defined.origin.clone(),
            known: nts_core::hir::facts::Facts::TOP,
            written: None,
            shape: ParamShape::Ordinary,
        });
        let id = ValueId(u32::try_from(values.len()).expect("a helper's values fit a u32"));
        values.push(Op {
            kind: OpKind::Param(u32::try_from(index).expect("live-ins are capped")),
            ty: defined.ty.clone(),
            origin: defined.origin.clone(),
        });
        renumbered.insert(value, id);
        ops.push(id);
    }
    for &value in run {
        let mut op = func.values[value.0 as usize].clone();
        nts_core::hir::simplify::substitute(&mut op.kind, |read| renumbered[&read]);
        let id = ValueId(u32::try_from(values.len()).expect("a helper's values fit a u32"));
        values.push(op);
        renumbered.insert(value, id);
        ops.push(id);
    }
    let result = boundary.live_out.map(|value| renumbered[&value]);
    Func {
        name,
        params,
        return_type: boundary.live_out.map_or(HirType::Void, |value| {
            func.values[value.0 as usize].ty.clone()
        }),
        values,
        blocks: vec![Block {
            params: Vec::new(),
            ops,
            terminator: Terminator::Return(result),
        }],
        origin: func.origin.clone(),
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: nts_core::hir::ExactArithmetic::default(),
        written_return: None,
        result_absent: nts_core::hir::Absent::Impossible,
        validation: None,
        written_return_elements: Vec::new(),
    }
}

/// `func` with straight-line runs of at most `budget` operations moved into
/// helpers, and the helpers, or `None` when no run could move.
///
/// `taken` holds the JVM spellings of every function's name
/// (`symbols::jvm_member_name`); each helper's is added as it is named, so
/// two splits in one program cannot meet either.
#[must_use]
pub fn split_for_method_limit<S: std::hash::BuildHasher>(
    func: &Func,
    budget: usize,
    taken: &mut std::collections::HashSet<String, S>,
) -> Option<(Func, Vec<Func>)> {
    let mut rewritten = func.clone();
    let mut helpers = Vec::new();
    let mut k = 0;
    for block in 0..func.blocks.len() {
        // Named left to right, so `F#split0` is the first run in the body.
        let named: Vec<(usize, usize, Cut, String)> = runs(func, block, budget.max(MIN_RUN))
            .into_iter()
            .map(|(start, end, boundary)| {
                let name = loop {
                    let candidate = helper_name(&func.name, k);
                    k += 1;
                    if taken.insert(nts_codegen_common::symbols::jvm_member_name(&candidate)) {
                        break candidate;
                    }
                };
                (start, end, boundary, name)
            })
            .collect();
        for (start, end, boundary, name) in &named {
            helpers.push(helper(
                func,
                name.clone(),
                &func.blocks[block].ops[*start..*end],
                boundary,
            ));
        }
        // Right to left, so a splice leaves the positions still to come alone.
        for (start, end, boundary, name) in named.into_iter().rev() {
            let origin = func.values[func.blocks[block].ops[start].0 as usize]
                .origin
                .clone();
            let call = OpKind::Call {
                callee: Callee::Direct(name),
                args: boundary.live_ins,
                frame: None,
            };
            let at = if let Some(value) = boundary.live_out {
                let ty = rewritten.values[value.0 as usize].ty.clone();
                rewritten.values[value.0 as usize] = Op {
                    kind: call,
                    ty,
                    origin,
                };
                value
            } else {
                let id = ValueId(
                    u32::try_from(rewritten.values.len()).expect("a function's values fit a u32"),
                );
                rewritten.values.push(Op {
                    kind: call,
                    ty: HirType::Void,
                    origin,
                });
                id
            };
            rewritten.blocks[block].ops.splice(start..end, [at]);
        }
    }
    if helpers.is_empty() {
        return None;
    }
    Some((rewritten, helpers))
}

/// The run budget a first split tries, in operations: about 20 KB of code at
/// the five bytes an operation of a literal takes, well inside the limit.
pub const FIRST_BUDGET: usize = 4096;

/// The smallest budget a retry halves to.
pub const MIN_BUDGET: usize = 256;

/// How many budgets a body is tried at before it keeps its decline.
pub const TRIES: usize = 4;

#[cfg(test)]
mod tests {
    use super::*;
    use nts_core::hir::{BinOp, Op};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    const F64: HirType = HirType::Float { bits: 64 };

    fn op(kind: OpKind, ty: HirType) -> Op {
        Op {
            kind,
            ty,
            origin: origin(),
        }
    }

    /// One block of `values` in order, returning `result`.
    fn func(values: Vec<Op>, result: ValueId) -> Func {
        let ops = (0..values.len())
            .map(|at| ValueId(u32::try_from(at).expect("a test body fits a u32")))
            .collect();
        Func {
            name: "f".to_owned(),
            params: vec![Param {
                name: "a".to_owned(),
                ty: F64,
                origin: origin(),
                known: nts_core::hir::facts::Facts::TOP,
                written: None,
                shape: ParamShape::Ordinary,
            }],
            return_type: F64,
            values,
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator: Terminator::Return(Some(result)),
            }],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: Vec::new(),
            exact: nts_core::hir::ExactArithmetic::default(),
            written_return: None,
            result_absent: nts_core::hir::Absent::Impossible,
            validation: None,
            written_return_elements: Vec::new(),
        }
    }

    fn add(lhs: u32, rhs: u32) -> Op {
        op(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: ValueId(lhs),
                rhs: ValueId(rhs),
            },
            F64,
        )
    }

    /// `%0 = param 0`, `%1 = const 1`, then a chain `%k = %(k-1) + %1`:
    /// each value is read by the next only, so any cut leaves one live.
    fn chain(length: u32) -> Func {
        let mut values = vec![op(OpKind::Param(0), F64), op(OpKind::ConstFloat(1.0), F64)];
        values.push(add(0, 1));
        for k in 3..length {
            values.push(add(k - 1, 1));
        }
        func(values, ValueId(length - 1))
    }

    #[test]
    fn a_run_moves_and_its_live_out_keeps_its_value() {
        let original = chain(42);
        let mut taken = FxHashSet::default();
        let (rewritten, helpers) =
            split_for_method_limit(&original, 16, &mut taken).expect("the chain splits");
        // %1, the const, is read after any run that holds it, beside the
        // chain's latest value: two live, so no run starts there. From %2,
        // runs of 16 leave one live each: %2..%17 and %18..%33, and the 8
        // left over are too short to be worth a call.
        assert_eq!(helpers.len(), 2);
        assert_eq!(helpers[0].name, "f#split0");
        assert_eq!(helpers[1].name, "f#split1");
        assert_eq!(rewritten.blocks[0].ops.len(), 2 + 2 + 8);
        // The call that replaces the first run is its live-out, %17, so
        // every later read of %17 is unchanged.
        assert_eq!(rewritten.blocks[0].ops[2], ValueId(17));
        let OpKind::Call {
            callee: Callee::Direct(name),
            args,
            ..
        } = &rewritten.values[17].kind
        else {
            panic!("{:?}", rewritten.values[17].kind);
        };
        assert_eq!(name, "f#split0");
        assert_eq!(
            args,
            &[ValueId(0), ValueId(1)],
            "its live-ins, in first-read order"
        );
        // The helper: the live-ins as its parameters, the run, the
        // live-out returned.
        assert_eq!(helpers[0].params.len(), 2);
        assert_eq!(helpers[0].blocks[0].ops.len(), 2 + 16);
        assert!(!helpers[0].exported);
        assert_eq!(
            helpers[0].blocks[0].terminator,
            Terminator::Return(Some(ValueId(17)))
        );
        // The second run reads the first's live-out, and the const.
        let OpKind::Call { args, .. } = &rewritten.values[33].kind else {
            panic!("{:?}", rewritten.values[33].kind);
        };
        assert_eq!(args, &[ValueId(17), ValueId(1)]);
    }

    #[test]
    fn a_stretch_whose_every_cut_leaves_two_values_live_is_not_split() {
        // Two chains, interleaved, and a call reading both latest values: at
        // every boundary in the stretch both are read after it.
        let mut values = vec![
            op(OpKind::Param(0), F64),
            op(OpKind::ConstFloat(1.0), F64),
            add(0, 1),
            add(0, 1),
        ];
        for k in 4..40u32 {
            values.push(add(k - 2, 1));
        }
        values.push(op(
            OpKind::Call {
                callee: Callee::Direct("g".to_owned()),
                args: vec![ValueId(38), ValueId(39)],
                frame: None,
            },
            F64,
        ));
        let original = func(values, ValueId(40));
        let mut taken = FxHashSet::default();
        assert!(split_for_method_limit(&original, 16, &mut taken).is_none());
    }

    #[test]
    fn a_call_ends_a_run_and_stays() {
        // A call can raise -- the caller's `nts_raising` test follows it --
        // so it never moves, and the runs either side of it do.
        let mut values = vec![op(OpKind::Param(0), F64), op(OpKind::ConstFloat(1.0), F64)];
        values.push(add(0, 1));
        for k in 3..20u32 {
            values.push(add(k - 1, 1));
        }
        values.push(op(
            OpKind::Call {
                callee: Callee::Direct("g".to_owned()),
                args: vec![ValueId(19)],
                frame: None,
            },
            F64,
        ));
        values.push(add(20, 1));
        for k in 22..40u32 {
            values.push(add(k - 1, 1));
        }
        let original = func(values, ValueId(39));
        let mut taken = FxHashSet::default();
        let (rewritten, helpers) =
            split_for_method_limit(&original, 64, &mut taken).expect("both sides split");
        assert_eq!(helpers.len(), 2);
        assert!(
            rewritten.blocks[0].ops.contains(&ValueId(20)),
            "the call stays"
        );
        for helper in &helpers {
            assert!(
                helper
                    .values
                    .iter()
                    .all(|op| !matches!(op.kind, OpKind::Call { .. })),
                "{} carried a call",
                helper.name
            );
        }
    }

    #[test]
    fn a_name_whose_jvm_spelling_is_taken_is_skipped() {
        // `f$split0` is a TypeScript name; `f#split0` would be spelled the
        // same on the JVM.
        let mut taken: FxHashSet<String> = ["f$split0".to_owned()].into_iter().collect();
        let (_, helpers) =
            split_for_method_limit(&chain(42), 16, &mut taken).expect("the chain splits");
        assert_eq!(helpers[0].name, "f#split1");
        assert_eq!(helpers[1].name, "f#split2");
    }
}
