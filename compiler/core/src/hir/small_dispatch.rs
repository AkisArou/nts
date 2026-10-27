//! A field read through an interface, where only a few classes move the field,
//! answered by testing for those classes.
//!
//! # The cost it removes
//!
//! `interface_access::materialize` turns an access through a face whose class
//! is lost into a call through the face's dispatch slot: the receiver's row if
//! its class has one, the face's positional storage if not. That is right for
//! any number of classes and costs the same for each: a load of the
//! descriptor, a load of the row, an indirect call nothing can inline, and the
//! accessor's ABI around a one-instruction body. `benchmarks/cases/face-fields`
//! reads `p.x`, writes it and reads `p.y` through `Point` over three holders;
//! node answers it at 2.77x nts's speed. Hand-editing the emitted C to test the
//! one class that holds `x` elsewhere and read the field directly took it from
//! 33.7 to 7.05 us, identical checksum.
//!
//! # The rule
//!
//! A class whose fields begin with the face's holds every one of them where
//! the face does (the plan's prefix receivers), so the face's positional read
//! is the answer for it whatever its row says -- and for the face's own
//! layout, which literals of it use. Only the other classes with a row in the
//! slot move the field. When there are at most [`MAX_TESTED`] of those, the
//! call becomes a test for each, a direct call to that class's row on the
//! object as its class, and a direct call to the slot's default for everything
//! else. That is the table's own behaviour, spelled where it is read: the
//! classes tested are read from the rows themselves, so a class this misses
//! would be one the table also sends to the default.
//! Cast faces have no positional default: their prefix and own-face rows are
//! tested too, and an unplanned receiver takes the named stop.
//!
//! Past [`MAX_TESTED`] the table stays: it is one indexed load however many
//! classes there are, and a chain of tests is not (decision 2 of
//! `docs/records/notebooks/interfaces-by-shape.md`, which this refines for small sets).
//!
//! # Where it runs
//!
//! After `materialize` makes the calls and the guard tests what is left, and
//! before numeric storage and specialization, which then see direct calls.

use rustc_hash::FxHashMap;

use super::{
    Absent, Block, BlockId, Callee, Func, HirType, ManagedType, Op, OpKind, Origin, Program,
    Terminator, TypeId, ValueId,
};

/// The most classes one access tests before the table is cheaper.
///
/// A test is a compare against a descriptor address and a predictable branch;
/// the table is two dependent loads and an indirect call. Two tests stay ahead
/// of that; past a handful the chain is the slower one, and its code grows
/// with every class.
pub(super) const MAX_TESTED: usize = 2;

/// What one slot's dispatch comes to: the classes to test with the row each
/// gets, and the body everything else gets.
pub(super) struct Answer {
    /// `(classes, row)`: every identity of the layouts sharing that row.
    pub tested: Vec<(Vec<TypeId>, String)>,
    pub default: String,
}

/// Answer every small interface field dispatch by class. Returns how many
/// calls it rewrote.
pub(super) fn answer_by_class(program: &mut Program) -> usize {
    let mut answers: FxHashMap<(u32, TypeId), Option<Answer>> = FxHashMap::default();
    let mut sites = Vec::new();
    for (at, func) in program.funcs.iter().enumerate() {
        for &id in func.blocks.iter().flat_map(|block| &block.ops) {
            let op = func.value(id);
            let OpKind::Call {
                callee: Callee::Virtual { slot, .. },
                args,
                ..
            } = &op.kind
            else {
                continue;
            };
            let Some(&receiver) = args.first() else {
                continue;
            };
            let HirType::Managed(ManagedType::Object(face)) = func.value(receiver).ty else {
                continue;
            };
            let answer = answers
                .entry((*slot, face))
                .or_insert_with(|| answer(program, *slot, face));
            if answer
                .as_ref()
                .is_some_and(|answer| signatures_agree(program, answer, op, func))
            {
                sites.push((at, id, *slot, face));
            }
        }
    }
    for &(at, id, slot, face) in &sites {
        let Some(Some(answer)) = answers.get(&(slot, face)) else {
            continue;
        };
        let owners: Vec<HirType> = answer
            .tested
            .iter()
            .map(|(_, row)| receiver_type(program, row))
            .collect();
        rewrite(&mut program.funcs[at], id, answer, &owners);
    }
    sites.len()
}

/// Indices shared by all read-contract queries over one owned program.
/// The memo belongs to the projection, never to the program being described.
pub(super) struct ReadIndex<'p> {
    pub program: &'p Program,
    pub layouts: super::fields::LayoutIndex,
    functions: FxHashMap<&'p str, Option<usize>>,
    rows: FxHashMap<u32, Vec<usize>>,
    row_slots: FxHashMap<&'p str, Vec<u32>>,
    answers: FxHashMap<(u32, TypeId), Option<std::sync::Arc<Answer>>>,
}

impl<'p> ReadIndex<'p> {
    pub(super) fn new(program: &'p Program) -> Self {
        let mut functions = FxHashMap::default();
        for (at, func) in program.funcs.iter().enumerate() {
            functions
                .entry(func.name.as_str())
                .and_modify(|at| *at = None)
                .or_insert(Some(at));
        }
        let mut rows: FxHashMap<u32, Vec<usize>> = FxHashMap::default();
        let mut row_slots: FxHashMap<&'p str, Vec<u32>> = FxHashMap::default();
        for (at, layout) in program.layouts.iter().enumerate() {
            for (slot, row) in layout.methods.iter().enumerate() {
                if let Some(row) = row
                    && let Ok(slot) = u32::try_from(slot)
                {
                    rows.entry(slot).or_default().push(at);
                    row_slots.entry(row.as_str()).or_default().push(slot);
                }
            }
        }
        for slots in row_slots.values_mut() {
            slots.sort_unstable();
            slots.dedup();
        }
        Self {
            program,
            row_slots,
            layouts: super::fields::LayoutIndex::build(program),
            functions,
            rows,
            answers: FxHashMap::default(),
        }
    }
    pub(super) fn function(&self, name: &str) -> Option<(usize, &'p Func)> {
        let at = self.functions.get(name).copied().flatten()?;
        Some((at, &self.program.funcs[at]))
    }
    pub(super) fn answer(&mut self, face: TypeId, slot: u32) -> Option<std::sync::Arc<Answer>> {
        self.answers
            .entry((slot, face))
            .or_insert_with(|| {
                let rows = self
                    .rows
                    .get(&slot)
                    .into_iter()
                    .flatten()
                    .map(|at| (*at, &self.program.layouts[*at]));
                answer_from_rows(self.program, slot, face, rows, |ty| {
                    self.layouts.of_class(ty)
                })
                .map(std::sync::Arc::new)
            })
            .clone()
    }
}

/// One CFG/use-site index per function, shared by every relevant family.
pub(super) struct ReadShape {
    incoming: Vec<Vec<usize>>,
    starts: FxHashMap<(TypeId, u32), Vec<usize>>,
}
impl ReadShape {
    pub(super) fn of(func: &Func, index: &ReadIndex<'_>) -> Self {
        let mut incoming = vec![Vec::new(); func.blocks.len()];
        let mut starts: FxHashMap<(TypeId, u32), Vec<usize>> = FxHashMap::default();
        for (at, block) in func.blocks.iter().enumerate() {
            for next in block.terminator.successors() {
                if let Some(edges) = incoming.get_mut(next.0 as usize) {
                    edges.push(at);
                }
            }
            if let Terminator::Branch {
                cond, then_target, ..
            } = &block.terminator
                && let OpKind::InstanceOf { value, .. } = &func.value(*cond).kind
                && let OpKind::Erase { value, .. } = &func.value(*value).kind
                && let HirType::Managed(ManagedType::Object(face)) = func.value(*value).ty
                && let Some(positive) = func.blocks.get(then_target.0 as usize)
                && positive.ops.len() == 2
                && let OpKind::Call {
                    callee: Callee::Direct(row),
                    ..
                } = &func.value(positive.ops[1]).kind
                && let Some(slots) = index.row_slots.get(row.as_str())
            {
                for slot in slots {
                    starts.entry((face, *slot)).or_default().push(at);
                }
            }
        }
        Self { incoming, starts }
    }
    pub(super) fn candidate_slots(&self) -> impl Iterator<Item = &(TypeId, u32)> {
        self.starts.keys()
    }
}

fn read_positive(
    index: &ReadIndex<'_>,
    func: &Func,
    (answer, row): (&Answer, &str),
    at: usize,
    erased: ValueId,
    join: Option<BlockId>,
    incoming: &[Vec<usize>],
) -> Option<(ValueId, ValueId, BlockId)> {
    let Terminator::Branch {
        then_target,
        else_target,
        ..
    } = &func.blocks[at].terminator
    else {
        return None;
    };
    let (Some(positive), Some(_)) = (
        func.blocks.get(then_target.0 as usize),
        func.blocks.get(else_target.0 as usize),
    ) else {
        return None;
    };
    if incoming[then_target.0 as usize] != [at]
        || incoming[else_target.0 as usize] != [at]
        || !positive.params.is_empty()
        || positive.ops.len() != 2
    {
        return None;
    }
    let (receiver, call) = (positive.ops[0], positive.ops[1]);
    if !matches!(&func.value(receiver).kind, OpKind::Unerase { value: from, .. } if *from == erased)
        || func.value(receiver).ty != receiver_kind(index.function(row).map(|(_, f)| f))
        || !matches!(&func.value(call).kind, OpKind::Call { callee: Callee::Direct(name), args, frame: None } if name == row && args.as_slice() == [receiver])
        || func.value(call).ty == HirType::Void
        || !signatures_agree_with(answer, func.value(call), func, |name| {
            index.function(name).map(|(_, f)| f)
        })
    {
        return None;
    }
    let Terminator::Jump { target, args } = &positive.terminator else {
        return None;
    };
    if args.as_slice() != [call] || join.is_some_and(|known| known != *target) {
        return None;
    }
    Some((receiver, call, *target))
}

fn read_default(
    index: &ReadIndex<'_>,
    func: &Func,
    face: TypeId,
    answer: &Answer,
    at: usize,
    root: ValueId,
    join: BlockId,
) -> Option<ValueId> {
    if receiver_kind(index.function(&answer.default).map(|(_, f)| f))
        != HirType::Managed(ManagedType::Object(face))
    {
        return None;
    }
    let fallback = &func.blocks[at];
    let [call] = fallback.ops.as_slice() else {
        return None;
    };
    if !fallback.params.is_empty()
        || !matches!(&func.value(*call).kind, OpKind::Call { callee: Callee::Direct(name), args, frame: None } if name == &answer.default && args.as_slice() == [root])
        || !matches!(&fallback.terminator, Terminator::Jump { target, args } if *target == join && args.as_slice() == [*call])
        || !signatures_agree_with(answer, func.value(*call), func, |name| {
            index.function(name).map(|(_, f)| f)
        })
    {
        return None;
    }
    Some(*call)
}

/// Revalidate the exact small-dispatch shape after preparation. This is a
/// read-only witness for listings, not permission to rewrite or infer owners.
/// Changed/pruned patterns simply provide no witness. A default name alone is
/// never evidence: every tested row and the shared receiver/join must match.
pub(super) fn matching_read_routes(
    index: &ReadIndex<'_>,
    func: &Func,
    face: TypeId,
    slot: u32,
    answer: &Answer,
    shape: &ReadShape,
) -> Vec<(ValueId, ValueId, ValueId)> {
    let incoming = &shape.incoming;
    let mut out = Vec::new();
    for &start in shape.starts.get(&(face, slot)).into_iter().flatten() {
        let mut at = start;
        let mut erased = None;
        let mut root = None;
        let mut join = None;
        let mut rows = Vec::new();
        let mut valid = true;
        for (classes, row) in &answer.tested {
            let block = &func.blocks[at];
            let Terminator::Branch {
                cond,
                then_target,
                then_args,
                else_target,
                else_args,
            } = &block.terminator
            else {
                valid = false;
                break;
            };
            let Some(Op {
                kind:
                    OpKind::InstanceOf {
                        value,
                        classes: actual,
                        by_layout: false,
                    },
                ..
            }) = func.values.get(cond.0 as usize)
            else {
                valid = false;
                break;
            };
            if actual != classes
                || !then_args.is_empty()
                || !else_args.is_empty()
                || then_target == else_target
                || !block.ops.contains(cond)
            {
                valid = false;
                break;
            }
            if erased.is_some_and(|known| known != *value) {
                valid = false;
                break;
            }
            erased = Some(*value);
            let Some(Op {
                kind: OpKind::Erase { value: source, .. },
                ..
            }) = func.values.get(value.0 as usize)
            else {
                valid = false;
                break;
            };
            if root.is_some_and(|known| known != *source)
                || func.value(*source).ty != HirType::Managed(ManagedType::Object(face))
                || (at == start && !block.ops.contains(value))
            {
                valid = false;
                break;
            }
            root = Some(*source);
            let Some((receiver, call, target)) =
                read_positive(index, func, (answer, row), at, *value, join, incoming)
            else {
                valid = false;
                break;
            };
            join = Some(target);
            rows.push((call, receiver, *source));
            at = else_target.0 as usize;
        }
        if !valid {
            continue;
        }
        let (Some(root), Some(join)) = (root, join) else {
            continue;
        };
        let Some(call) = read_default(index, func, face, answer, at, root, join) else {
            continue;
        };
        rows.push((call, root, root));
        out.extend(rows);
    }
    out
}

/// The classes `slot` moves its field for, seen through `face`, if few enough
/// to test.
fn answer(program: &Program, slot: u32, face: TypeId) -> Option<Answer> {
    answer_from_rows(
        program,
        slot,
        face,
        program.layouts.iter().enumerate(),
        |ty| super::typed_signatures::layout_of(program, ty),
    )
}

fn answer_from_rows<'p>(
    program: &'p Program,
    slot: u32,
    face: TypeId,
    rows: impl Iterator<Item = (usize, &'p super::Layout)>,
    layout_of: impl Fn(TypeId) -> Option<usize>,
) -> Option<Answer> {
    let plan = &program.interface_access;
    let default = plan.default_for(slot)?.to_owned();
    let face_layout = layout_of(face)?;
    // Cast faces have a named-stop default, so prefix and own-face rows must
    // be tested too. They cannot be sent to a positional default.
    let positional: Vec<usize> = if program.cast_faces.contains(&face) {
        Vec::new()
    } else {
        plan.prefix_receivers(face)?
            .iter()
            .filter_map(|ty| layout_of(*ty))
            .chain(std::iter::once(face_layout))
            .collect()
    };
    let mut tested: Vec<(Vec<TypeId>, String)> = Vec::new();
    for (at, layout) in rows {
        let Some(row) = layout.methods.get(slot as usize).and_then(Option::as_deref) else {
            continue;
        };
        if positional.contains(&at) || row == default {
            continue;
        }
        match tested.iter_mut().find(|(_, body)| body == row) {
            Some((classes, _)) => classes.extend(layout.types.iter().copied()),
            None => tested.push((layout.types.clone(), row.to_owned())),
        }
    }
    if tested.is_empty() || tested.len() > MAX_TESTED {
        return None;
    }
    for (classes, _) in &mut tested {
        classes.sort_unstable();
        classes.dedup();
    }
    Some(Answer { tested, default })
}

/// Whether every body the answer calls takes the call's arguments and answers
/// its type. A family's rows share one signature, so this holds; it is asked
/// rather than assumed, because a direct call that disagrees is a wrong
/// program and a table that stays is only a slower one.
fn signatures_agree(program: &Program, answer: &Answer, op: &Op, func: &Func) -> bool {
    signatures_agree_with(answer, op, func, |name| {
        program.funcs.iter().find(|f| f.name == name)
    })
}

fn signatures_agree_with<'p>(
    answer: &Answer,
    op: &Op,
    func: &Func,
    body: impl Fn(&str) -> Option<&'p Func>,
) -> bool {
    let OpKind::Call { args, .. } = &op.kind else {
        return false;
    };
    answer
        .tested
        .iter()
        .map(|(_, row)| row.as_str())
        .chain(std::iter::once(answer.default.as_str()))
        .all(|name| {
            body(name).is_some_and(|callee| {
                callee.return_type == op.ty
                    && callee.params.len() == args.len()
                    && callee
                        .params
                        .iter()
                        .zip(args)
                        .skip(1)
                        .all(|(param, arg)| param.ty == func.value(*arg).ty)
            })
        })
}

/// The type a row takes its receiver at: the class it was written for.
fn receiver_type(program: &Program, row: &str) -> HirType {
    receiver_kind(program.funcs.iter().find(|f| f.name == row))
}
fn receiver_kind(func: Option<&Func>) -> HirType {
    func.and_then(|f| f.params.first())
        .map_or(HirType::Erased, |p| p.ty.clone())
}

/// What every arm of one rewritten call shares: the receiver as one erased
/// value, the call's arguments and answer type, where it came from, and the
/// block its arms meet in.
struct Site {
    erased: ValueId,
    args: Vec<ValueId>,
    ty: HirType,
    origin: Origin,
    join: BlockId,
    answers: bool,
}

/// Add `op` to `func`'s values, placed in no block yet.
fn append(func: &mut Func, op: Op) -> ValueId {
    let new = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(op);
    new
}

impl Site {
    fn push(&self, func: &mut Func, kind: OpKind, ty: HirType) -> ValueId {
        append(
            func,
            Op {
                kind,
                ty,
                origin: self.origin.clone(),
            },
        )
    }

    /// The jump that carries an arm's answer to the join.
    fn to_join(&self, result: ValueId) -> Terminator {
        Terminator::Jump {
            target: self.join,
            args: if self.answers {
                vec![result]
            } else {
                Vec::new()
            },
        }
    }
}

/// Replace the call `id` with a test per class, a direct call to its row, and
/// the default's direct call, all meeting where the call's result is read.
fn rewrite(func: &mut Func, id: ValueId, answer: &Answer, owners: &[HirType]) {
    let Some((at, position)) = func.blocks.iter().enumerate().find_map(|(at, block)| {
        block
            .ops
            .iter()
            .position(|op| *op == id)
            .map(|position| (at, position))
    }) else {
        return;
    };
    let call = func.values[id.0 as usize].clone();
    let OpKind::Call { args, .. } = &call.kind else {
        return;
    };
    let answers = call.ty != HirType::Void;
    let erased = append(
        func,
        Op {
            kind: OpKind::Erase {
                value: args[0],
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            ty: HirType::Erased,
            origin: call.origin.clone(),
        },
    );
    let site = Site {
        erased,
        args: args.clone(),
        ty: call.ty.clone(),
        origin: call.origin.clone(),
        join: BlockId(u32::try_from(func.blocks.len()).unwrap_or(u32::MAX)),
        answers,
    };

    // The join holds what followed the call; where the call answered, its
    // value becomes the join's parameter, so every read of it stays as it was.
    let after = func.blocks[at].ops.split_off(position + 1);
    func.blocks[at].ops.pop();
    let terminator = std::mem::replace(&mut func.blocks[at].terminator, Terminator::Unreachable);
    func.blocks.push(Block {
        params: if answers { vec![id] } else { Vec::new() },
        ops: after,
        terminator,
    });
    if answers {
        func.values[id.0 as usize].kind = OpKind::BlockParam(0);
    }
    func.blocks[at].ops.push(site.erased);

    let mut testing = at;
    for ((classes, row), owner) in answer.tested.iter().zip(owners) {
        testing = class_arm(func, &site, testing, (classes, row, owner));
    }
    // Every other class: the face's positional storage, as the table's
    // fallback reads it.
    let result = site.push(
        func,
        OpKind::Call {
            callee: Callee::Direct(answer.default.clone()),
            args: site.args.clone(),
            frame: None,
        },
        site.ty.clone(),
    );
    func.blocks[testing].ops.push(result);
    func.blocks[testing].terminator = site.to_join(result);
}

/// One class's arm, tested from block `testing`: the tag test, the object as
/// its class, and a direct call to that class's row, carried to the join.
/// Answers the block the next test goes in.
fn class_arm(
    func: &mut Func,
    site: &Site,
    testing: usize,
    (classes, row, owner): (&[TypeId], &String, &HirType),
) -> usize {
    let test = site.push(
        func,
        OpKind::InstanceOf {
            value: site.erased,
            classes: classes.to_vec(),
            by_layout: false,
        },
        HirType::Bool,
    );
    func.blocks[testing].ops.push(test);
    let arm = BlockId(u32::try_from(func.blocks.len()).unwrap_or(u32::MAX));
    let next = BlockId(arm.0 + 1);
    func.blocks[testing].terminator = Terminator::Branch {
        cond: test,
        then_target: arm,
        then_args: Vec::new(),
        else_target: next,
        else_args: Vec::new(),
    };
    // The object as its class: the test just made is the tag test an
    // unerase is licensed by.
    let narrowed = site.push(func, OpKind::unerase(site.erased), owner.clone());
    let mut passed = site.args.clone();
    passed[0] = narrowed;
    let result = site.push(
        func,
        OpKind::Call {
            callee: Callee::Direct(row.clone()),
            args: passed,
            frame: None,
        },
        site.ty.clone(),
    );
    func.blocks.push(Block {
        params: Vec::new(),
        ops: vec![narrowed, result],
        terminator: site.to_join(result),
    });
    func.blocks.push(Block {
        params: Vec::new(),
        ops: Vec::new(),
        terminator: Terminator::Unreachable,
    });
    next.0 as usize
}

#[cfg(test)]
mod read_contract_tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]
    use super::*;
    use nts_frontend_ts::Frontend;

    fn fixture(name: &str) -> Program {
        let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../tests/programs/{name}/tsconfig.json"))
            .canonicalize_utf8()
            .expect("gated fixture");
        let snapshot = Frontend::new(config.parent().unwrap())
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("capture fixture");
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let raw = crate::hir::lower::lower(&snapshot).program;
        let raw_contracts = crate::hir::interface_access::read_contracts(&raw);
        assert!(
            raw_contracts.is_empty(),
            "raw lowering emitted contracts: {raw_contracts:?}"
        );
        let prepared = crate::hir::prepare(&snapshot).expect("single normal preparation");
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        prepared.program
    }

    #[test]
    fn read_contracts_describe_final_prefix_and_routed_sites_without_mutation() {
        for (name, mode, count) in [
            ("exact-keys-through-member-reads", "stored-prefix", 1),
            (
                "a-symbol-cast-keeps-the-supplier-layout",
                "validated-small-dispatch",
                2,
            ),
        ] {
            let program = fixture(name);
            let before = format!("{program:?}");
            let proofs = crate::hir::interface_access::read_contracts(&program);
            let proofs: Vec<_> = proofs
                .iter()
                .filter(|proof| program.funcs[proof.function].name == "castKeyed")
                .collect();
            assert_eq!(proofs.len(), count);
            assert!(proofs.iter().all(|proof| proof.mode == mode));
            for proof in proofs {
                assert!(matches!(
                    proof.member,
                    nts_semantic_schema::PropertyKey::Symbol(_)
                ));
                let func = &program.funcs[proof.function];
                assert!(
                    func.blocks
                        .iter()
                        .any(|block| block.ops.contains(&proof.operation))
                );
                assert!(matches!(
                    func.value(proof.root).kind,
                    OpKind::Unerase { .. }
                ));
                assert_eq!(
                    proof.argument,
                    (mode == "validated-small-dispatch").then_some(0)
                );
            }
            assert_eq!(format!("{program:?}"), before);
            assert_mixed_root_domain(&program, mode, count);
        }
    }

    #[test]
    fn a_default_name_without_the_planned_guard_has_no_read_contract() {
        let mut program = fixture("a-symbol-cast-keeps-the-supplier-layout");
        let at = program
            .funcs
            .iter()
            .position(|f| f.name == "castKeyed")
            .expect("erased seam retained");
        let func = &mut program.funcs[at];
        let test = func
            .values
            .iter_mut()
            .find(|op| matches!(op.kind, OpKind::InstanceOf { .. }))
            .expect("actual dispatch test");
        let OpKind::InstanceOf { classes, .. } = &mut test.kind else {
            unreachable!()
        };
        classes.clear();
        assert!(
            crate::hir::interface_access::read_contracts(&program)
                .iter()
                .all(|proof| proof.function != at)
        );
    }
    fn core_fixture(name: &str) -> Program {
        let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!(
                "tests/programs/field-read-contracts/tsconfig.{name}.json"
            ))
            .canonicalize_utf8()
            .expect("owned producer input");
        let snapshot = Frontend::new(config.parent().unwrap())
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("capture producer input");
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let prepared = crate::hir::prepare(&snapshot).expect("normal single preparation");
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        prepared.program
    }

    #[test]
    fn removing_one_nonprefix_row_and_its_guard_does_not_license_the_default() {
        let mut program = core_fixture("routes");
        let function = program
            .funcs
            .iter()
            .position(|f| f.name == "read")
            .expect("erased reader");
        let proofs = crate::hir::interface_access::read_contracts(&program);
        let roots: Vec<_> = proofs.iter().filter(|p| p.function == function).collect();
        assert_eq!(
            roots.len(),
            3,
            "two nonprefix rows and the prefix default are actually reached"
        );
        let face = roots[0].face;
        let family = program
            .interface_access
            .families
            .iter()
            .find(|f| f.face == face)
            .unwrap()
            .clone();
        assert_eq!(
            roots[0].owners.iter().filter(|(_, prefix)| !prefix).count(),
            2
        );
        let planned = answer(&program, family.getter.slot, face).expect("small dispatch");
        assert_eq!(planned.tested.len(), 2);
        let removed = planned.tested[0].0.clone();
        for layout in &mut program.layouts {
            if layout.types.iter().any(|id| removed.contains(id)) {
                layout.methods[family.getter.slot as usize] = None;
            }
        }
        let func = &mut program.funcs[function];
        let (start, condition, positive, next) = func.blocks.iter().enumerate().find_map(|(at, block)| {
            let Terminator::Branch { cond, then_target, else_target, .. } = &block.terminator else { return None; };
            matches!(&func.value(*cond).kind, OpKind::InstanceOf { classes, .. } if *classes == removed)
                .then_some((at, *cond, then_target.0 as usize, else_target.0 as usize))
        }).expect("actual first owner guard");
        let next_ops = func.blocks[next].ops.clone();
        let next_terminator = func.blocks[next].terminator.clone();
        func.blocks[start].ops.retain(|id| *id != condition);
        func.blocks[start].ops.extend(next_ops);
        func.blocks[start].terminator = next_terminator;
        for at in [positive, next] {
            func.blocks[at].ops.clear();
            func.blocks[at].terminator = Terminator::Unreachable;
        }
        let mut index = ReadIndex::new(&program);
        let remaining = index
            .answer(face, family.getter.slot)
            .expect("one PRESENT row remains");
        assert_eq!(remaining.tested.len(), 1);
        assert!(
            !matching_read_routes(
                &index,
                &program.funcs[function],
                face,
                family.getter.slot,
                &remaining,
                &ReadShape::of(&program.funcs[function], &index)
            )
            .is_empty(),
            "present-row pattern alone still appears valid"
        );
        assert!(
            crate::hir::interface_access::read_contracts(&program)
                .iter()
                .all(|p| p.function != function),
            "missing licensed owner blocks the complete proof"
        );
    }

    #[test]
    fn a_mutated_default_storage_body_invalidates_the_final_read_proof() {
        let original = fixture("a-symbol-cast-keeps-the-supplier-layout");
        let function = original
            .funcs
            .iter()
            .position(|f| f.name == "castKeyed")
            .unwrap();
        let proofs = crate::hir::interface_access::read_contracts(&original);
        let proof = proofs
            .iter()
            .find(|p| p.function == function)
            .expect("routed proof");
        let family = original
            .interface_access
            .families
            .iter()
            .find(|f| f.face == proof.face)
            .unwrap();
        let default = original
            .interface_access
            .default_for(family.getter.slot)
            .unwrap()
            .to_owned();
        for alias in [false, true] {
            let mut program = original.clone();
            let body = program
                .funcs
                .iter_mut()
                .find(|f| f.name == default)
                .unwrap();
            if alias {
                let parameter = body.blocks[0].ops[0];
                let value = ValueId(u32::try_from(body.values.len()).unwrap());
                body.values.push(Op {
                    kind: OpKind::Convert(parameter),
                    ty: body.value(parameter).ty.clone(),
                    origin: body.value(parameter).origin.clone(),
                });
                body.blocks[0].ops.push(value);
            } else {
                let op = body
                    .values
                    .iter_mut()
                    .find(|op| matches!(op.kind, OpKind::FieldGet { .. }))
                    .unwrap();
                let OpKind::FieldGet { field, .. } = &mut op.kind else {
                    unreachable!()
                };
                *field += 1;
            }
            assert!(
                crate::hir::interface_access::read_contracts(&program)
                    .iter()
                    .all(|p| p.function != function)
            );
        }
    }

    #[test]
    fn an_eager_cast_face_cannot_gain_a_same_geometry_positional_proof() {
        let mut program = core_fixture("eager");
        let family = program
            .interface_access
            .families
            .iter()
            .find(|f| program.cast_faces.contains(&f.face) && f.field.is_some())
            .expect("actual anonymous cast family")
            .clone();
        assert!(family.eager);
        assert!(
            !family.stored_dispatch,
            "the old negated-flag test was insufficient"
        );
        let layouts = crate::hir::fields::LayoutIndex::build(&program);
        let face = layouts.of_class(family.face).unwrap();
        let field = family.field.unwrap();
        assert!(
            !family.owners.is_empty(),
            "expected real owners: {:?}",
            family.owners
        );
        assert!(
            family
                .owners
                .iter()
                .all(|owner| crate::hir::fields::shares_storage(
                    &program.layouts[face],
                    &program.layouts[layouts.of_class(*owner).unwrap()],
                    field
                )),
            "the negative actually has matching storage"
        );
        let (at, block, root) = program
            .funcs
            .iter()
            .enumerate()
            .find_map(|(at, f)| {
                f.blocks.iter().enumerate().find_map(|(block, b)| {
                    b.ops.iter().find_map(|id| {
                        (matches!(f.value(*id).kind, OpKind::Unerase { .. })
                            && f.value(*id).ty
                                == HirType::Managed(ManagedType::Object(family.face)))
                        .then_some((at, block, *id))
                    })
                })
            })
            .expect("final erased receiver retained");
        let ty = program.layouts[face].fields[field as usize].ty.clone();
        let func = &mut program.funcs[at];
        let bad = ValueId(u32::try_from(func.values.len()).unwrap());
        func.values.push(Op {
            kind: OpKind::FieldGet {
                object: root,
                field,
            },
            ty,
            origin: func.value(root).origin.clone(),
        });
        func.blocks[block].ops.push(bad);
        assert!(
            crate::hir::interface_access::read_contracts(&program)
                .iter()
                .all(|p| p.function != at || p.operation != bad)
        );
    }
    fn add_mixed_reads(
        mixed: &mut Func,
        proof: &crate::hir::interface_access::ReadContract,
        family: &crate::hir::interface_access::Family,
        mode: &str,
    ) -> (ValueId, ValueId, Vec<ValueId>) {
        let (root, face, field) = (proof.root, proof.face, proof.field);
        mixed.name.push_str("@projection-mixed");
        // This new local clone has no callers. Its parameter definition and
        // header agree; existing source functions/callers stay untouched.
        let mut named = mixed.params[0].clone();
        named.name = "named".into();
        named.ty = HirType::Managed(ManagedType::Object(face));
        mixed.params.push(named);
        let origin = mixed.value(root).origin.clone();
        let parameter = append(
            mixed,
            Op {
                kind: OpKind::Param(1),
                ty: HirType::Managed(ManagedType::Object(face)),
                origin: origin.clone(),
            },
        );
        let converted = append(
            mixed,
            Op {
                kind: OpKind::Convert(parameter),
                ty: HirType::Managed(ManagedType::Object(face)),
                origin: origin.clone(),
            },
        );
        let mut added = vec![parameter, converted];
        let mut sites = Vec::new();
        for receiver in [parameter, converted] {
            let kind = if mode == "stored-prefix" {
                OpKind::FieldGet {
                    object: receiver,
                    field,
                }
            } else {
                OpKind::Call {
                    callee: Callee::Virtual {
                        slot: family.getter.slot,
                        declared: family.getter.declared.clone(),
                    },
                    args: vec![receiver],
                    frame: None,
                }
            };
            let id = append(
                mixed,
                Op {
                    kind,
                    ty: proof.representation.clone(),
                    origin: origin.clone(),
                },
            );
            added.push(id);
            sites.push(id);
        }
        drop(mixed.blocks[0].ops.splice(1..1, added));
        (parameter, converted, sites)
    }

    /// Reuse the real captured/prepared plan above. The owned projection-only
    /// clone adds an independent typed parameter and identity conversion; it
    /// is not a source-execution or call-ABI experiment. No extra capture.
    fn assert_mixed_root_domain(original: &Program, mode: &str, expected: usize) {
        let at = original
            .funcs
            .iter()
            .position(|f| f.name == "castKeyed")
            .unwrap();
        let original_proofs = crate::hir::interface_access::read_contracts(original);
        let proof = original_proofs.iter().find(|p| p.function == at).unwrap();
        let (root, face) = (proof.root, proof.face);
        let family = original
            .interface_access
            .families
            .iter()
            .find(|f| f.face == face && f.field == Some(proof.field))
            .unwrap();
        let mut mixed = original.funcs[at].clone();
        let (parameter, converted, sites) = add_mixed_reads(&mut mixed, proof, family, mode);
        if mode == "validated-small-dispatch" {
            let answer = answer(original, family.getter.slot, face).expect("actual read planner");
            let owners: Vec<_> = answer
                .tested
                .iter()
                .map(|(_, row)| receiver_type(original, row))
                .collect();
            for id in sites {
                rewrite(&mut mixed, id, &answer, &owners);
            }
        }
        let mut program = original.clone();
        let mixed_at = program.funcs.len();
        program.funcs.push(mixed);
        if mode == "validated-small-dispatch" {
            let mut index = ReadIndex::new(&program);
            let planned = index.answer(face, family.getter.slot).unwrap();
            let candidates = matching_read_routes(
                &index,
                &program.funcs[mixed_at],
                face,
                family.getter.slot,
                &planned,
                &ReadShape::of(&program.funcs[mixed_at], &index),
            );
            for unsupported in [parameter, converted] {
                assert!(
                    candidates.iter().any(|(_, _, root)| *root == unsupported),
                    "unsupported route is a real matching candidate"
                );
            }
        }
        let proofs = crate::hir::interface_access::read_contracts(&program);
        let mixed_proofs: Vec<_> = proofs.iter().filter(|p| p.function == mixed_at).collect();
        assert_eq!(
            mixed_proofs.len(),
            expected,
            "independent valid roots survive beside unsupported candidates"
        );
        assert!(mixed_proofs.iter().all(|p| p.root == root));
        for proof in &proofs {
            let func = &program.funcs[proof.function];
            assert!(
                func.blocks.iter().any(|b| b.ops.contains(&proof.root)),
                "root is active"
            );
            assert!(matches!(
                func.value(proof.root).kind,
                OpKind::Unerase { .. }
            ));
            assert_eq!(
                func.value(proof.root).ty,
                HirType::Managed(ManagedType::Object(proof.face))
            );
        }
    }
}
