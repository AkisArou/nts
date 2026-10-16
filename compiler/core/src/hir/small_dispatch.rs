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
//!
//! Past [`MAX_TESTED`] the table stays: it is one indexed load however many
//! classes there are, and a chain of tests is not (decision 2 of
//! `docs/interfaces-by-shape.md`, which this refines for small sets).
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
struct Answer {
    /// `(classes, row)`: every identity of the layouts sharing that row.
    tested: Vec<(Vec<TypeId>, String)>,
    default: String,
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

/// The classes `slot` moves its field for, seen through `face`, if few enough
/// to test.
fn answer(program: &Program, slot: u32, face: TypeId) -> Option<Answer> {
    let plan = &program.interface_access;
    let default = plan.default_for(slot)?.to_owned();
    let face_layout = super::typed_signatures::layout_of(program, face)?;
    let positional: Vec<usize> = plan
        .prefix_receivers(face)?
        .iter()
        .filter_map(|ty| super::typed_signatures::layout_of(program, *ty))
        .chain(std::iter::once(face_layout))
        .collect();
    let mut tested: Vec<(Vec<TypeId>, String)> = Vec::new();
    for (at, layout) in program.layouts.iter().enumerate() {
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
    let OpKind::Call { args, .. } = &op.kind else {
        return false;
    };
    let body = |name: &str| {
        program
            .funcs
            .iter()
            .find(|candidate| candidate.name == name)
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
    program
        .funcs
        .iter()
        .find(|func| func.name == row)
        .and_then(|func| func.params.first())
        .map_or(HirType::Erased, |param| param.ty.clone())
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
    let narrowed = site.push(func, OpKind::Unerase { value: site.erased }, owner.clone());
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
