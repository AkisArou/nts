use crate::hir::{Absent, Block, BlockId, Func, HirType, Op, OpKind, Program, Terminator, ValueId};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::Origin;

fn origin() -> Origin {
    Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    })
}

fn function() -> Func {
    Func {
        name: "chain".to_owned(),
        params: Vec::new(),
        return_type: HirType::Void,
        written_return: None,
        written_return_elements: Vec::new(),
        validation: None,
        result_absent: Absent::Impossible,
        values: Vec::new(),
        blocks: Vec::new(),
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
    }
}

fn value(func: &mut Func, kind: OpKind) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).expect("fixture value index fits"));
    func.values.push(Op {
        kind,
        ty: HirType::NUMBER,
        origin: origin(),
    });
    id
}

/// Every pure operation feeds the following merge. Deleting only operations or
/// only parameters leaves the other half of this chain artificially live.
fn alternating(n: u32, observed: bool) -> Func {
    let mut func = function();
    let mut carried = value(&mut func, OpKind::ConstFloat(7.0));
    func.blocks.push(Block {
        params: Vec::new(),
        ops: vec![carried],
        terminator: Terminator::Jump {
            target: BlockId(1),
            args: vec![carried],
        },
    });
    for at in 1..=n {
        let param = value(&mut func, OpKind::BlockParam(0));
        carried = value(&mut func, OpKind::Convert(param));
        let terminator = if at < n {
            Terminator::Jump {
                target: BlockId(at + 1),
                args: vec![carried],
            }
        } else {
            Terminator::Return(observed.then_some(carried))
        };
        func.blocks.push(Block {
            params: vec![param],
            ops: vec![carried],
            terminator,
        });
    }
    if observed {
        func.return_type = HirType::NUMBER;
    }
    func
}

#[test]
fn joint_orphans_drop_the_entire_alternating_phi_operation_chain() {
    for n in [1, 16, 64, 256, 4096] {
        let mut program = Program {
            funcs: vec![alternating(n, false)],
            ..Program::default()
        };
        let original_values = program.funcs[0].values.len();
        crate::hir::collect_orphans(&mut program);
        let func = &program.funcs[0];
        let parameters: usize = func.blocks.iter().map(|block| block.params.len()).sum();
        let operations: usize = func.blocks.iter().map(|block| block.ops.len()).sum();
        assert_eq!((parameters, operations), (0, 0), "depth {n}");
        assert_eq!(
            func.values.len(),
            original_values,
            "arena identities remain stable"
        );
    }
}

#[test]
fn an_observed_alternating_chain_keeps_every_actual_input() {
    for n in [1, 16, 64, 256, 4096] {
        let mut program = Program {
            funcs: vec![alternating(n, true)],
            ..Program::default()
        };
        let before = format!("{:?}", program.funcs[0]);
        crate::hir::collect_orphans(&mut program);
        assert_eq!(format!("{:?}", program.funcs[0]), before, "depth {n}");
    }
}

#[test]
fn actual_alternating_chain_work_is_linear_for_dead_and_observed_values() {
    for observed in [false, true] {
        for n in [16, 64, 256] {
            let mut func = alternating(n, observed);
            super::work::reset();
            super::collect(&mut func);
            let work = super::work::take();
            let n = u64::from(n);
            let expected = [
                5 * (n + 1),
                n + 1,
                n + 1,
                n,
                n,
                0,
                if observed { 2 * n + 1 } else { 0 },
                if observed { 2 * n } else { 0 },
                n + 1,
                n,
                if observed { n } else { 0 },
                n,
            ];
            eprintln!("alternating depth={n} observed={observed} work={work:?}");
            assert_eq!(
                work, expected,
                "actual construction, mark and deletion work"
            );
        }
    }
}

#[test]
fn parameter_only_cycles_have_no_observable_root() {
    let mut func = alternating(1, false);
    let param = func.blocks[1].params[0];
    func.blocks[1].ops.clear();
    func.blocks[1].terminator = Terminator::Jump {
        target: BlockId(1),
        args: vec![param],
    };
    assert_eq!(super::prune_parameters(&mut func), 1);
    assert!(func.blocks.iter().all(|block| block.params.is_empty()));
}

#[test]
fn parameter_compaction_updates_positions_and_actual_edge_arguments_only() {
    let mut func = alternating(1, true);
    let first = func.blocks[1].params[0];
    let dead = value(&mut func, OpKind::BlockParam(1));
    let kept = value(&mut func, OpKind::BlockParam(2));
    func.blocks[1].params.extend([dead, kept]);
    let Terminator::Jump { args, .. } = &mut func.blocks[0].terminator else {
        panic!("entry edge")
    };
    let first_argument = args[0];
    let discarded_argument = value(&mut func, OpKind::ConstFloat(9.0));
    let argument = value(&mut func, OpKind::ConstFloat(11.0));
    func.blocks[0].ops.extend([discarded_argument, argument]);
    let Terminator::Jump { args, .. } = &mut func.blocks[0].terminator else {
        panic!("entry edge")
    };
    assert_eq!(args, &[first_argument]);
    args.extend([discarded_argument, argument]);
    func.blocks[1].ops.clear();
    func.blocks[1].terminator = Terminator::Return(Some(kept));
    let arena_len = func.values.len();
    super::collect(&mut func);
    assert_eq!(func.blocks[1].params, [kept]);
    assert!(matches!(
        func.values[kept.0 as usize].kind,
        OpKind::BlockParam(0)
    ));
    assert_eq!(func.values.len(), arena_len);
    assert!(matches!(
        func.values[first.0 as usize].kind,
        OpKind::BlockParam(0)
    ));
    assert_eq!(func.blocks[1].terminator, Terminator::Return(Some(kept)));
    assert!(matches!(&func.blocks[0].terminator,
        Terminator::Jump { args, .. } if args == &[argument]));
}

fn typed(func: &mut Func, kind: OpKind, ty: HirType) -> ValueId {
    let id = value(func, kind);
    func.values[id.0 as usize].ty = ty;
    id
}

fn fresh_ring(n: usize, observed: bool) -> Func {
    let mut func = function();
    let ty = HirType::Managed(crate::hir::ManagedType::Object(
        nts_semantic_schema::TypeId(1),
    ));
    let objects: Vec<_> = (0..n)
        .map(|_| typed(&mut func, OpKind::ObjectNew { frame: false }, ty.clone()))
        .collect();
    let mut ops = objects.clone();
    for at in 0..n {
        ops.push(typed(
            &mut func,
            OpKind::FieldSet {
                object: objects[at],
                field: 0,
                value: objects[(at + 1) % n],
            },
            HirType::Void,
        ));
    }
    if observed {
        func.return_type = ty;
    }
    func.blocks.push(Block {
        params: Vec::new(),
        ops,
        terminator: Terminator::Return(observed.then_some(objects[0])),
    });
    func
}

#[test]
fn fresh_store_cycles_follow_the_actual_observed_object() {
    for observed in [false, true] {
        for n in [16, 64, 256] {
            let mut func = fresh_ring(n, observed);
            super::work::reset();
            super::collect(&mut func);
            let work = super::work::take();
            assert_eq!(func.blocks[0].ops.len(), if observed { 2 * n } else { 0 });
            assert_eq!(work[super::work::Counter::Store as usize], n as u64);
            assert_eq!(
                work[super::work::Counter::Value as usize],
                if observed { 2 * n as u64 } else { 0 }
            );
            assert_eq!(
                work[super::work::Counter::Operand as usize],
                if observed { 3 * n as u64 } else { 0 }
            );
            eprintln!("fresh ring={n} observed={observed} work={work:?}");
        }
    }
}

#[test]
fn effects_keep_their_operands_while_unplaced_arena_entries_do_not_seed_them() {
    let mut func = function();
    let input = value(&mut func, OpKind::ConstFloat(7.0));
    let call = value(
        &mut func,
        OpKind::Call {
            callee: crate::hir::Callee::External("observe".to_owned()),
            args: vec![input],
            frame: None,
        },
    );
    let unused = value(&mut func, OpKind::Convert(input));
    func.blocks.push(Block {
        params: Vec::new(),
        ops: vec![input, call, unused],
        terminator: Terminator::Return(None),
    });
    let mut unplaced = func.clone();
    unplaced.blocks[0].ops.retain(|id| *id != call);
    super::collect(&mut func);
    assert_eq!(func.blocks[0].ops, [input, call]);
    super::collect(&mut unplaced);
    assert_eq!(unplaced.blocks[0].ops, [] as [ValueId; 0]);
    assert!(matches!(
        &unplaced.values[call.0 as usize].kind,
        OpKind::Call { .. }
    ));
}

#[test]
fn an_unread_reads_only_runtime_call_is_collected_and_an_unread_effect_is_not() {
    // `new ArrayBuffer(8, { maxByteLength: 16 })` once its `length > max`
    // comparison has folded: the two `NTS_READS_ONLY` conversions it read are
    // dead, and C rejects an ignored pure result. A call that may do anything
    // stays, with its operand.
    let mut func = function();
    let call = |func: &mut Func, name: &str, arg: ValueId| {
        value(
            func,
            OpKind::Call {
                callee: crate::hir::Callee::External(name.to_owned()),
                args: vec![arg],
                frame: None,
            },
        )
    };
    let length = value(&mut func, OpKind::ConstFloat(8.0));
    let max = value(&mut func, OpKind::ConstFloat(16.0));
    let length_index = call(&mut func, "nts_to_index", length);
    let max_index = call(&mut func, "nts_to_index", max);
    let observed = call(&mut func, "observe", length);
    func.blocks.push(Block {
        params: Vec::new(),
        ops: vec![length, max, length_index, max_index, observed],
        terminator: Terminator::Return(None),
    });
    assert!(crate::hir::runtime::reads_only("nts_to_index"));
    super::collect(&mut func);
    assert_eq!(func.blocks[0].ops, [length, observed]);
}

#[test]
fn a_store_into_an_external_object_remains_an_effect() {
    let mut func = function();
    let ty = HirType::Managed(crate::hir::ManagedType::Object(
        nts_semantic_schema::TypeId(1),
    ));
    let object = typed(&mut func, OpKind::GlobalGet(0), ty);
    let input = value(&mut func, OpKind::ConstFloat(7.0));
    let store = typed(
        &mut func,
        OpKind::FieldSet {
            object,
            field: 0,
            value: input,
        },
        HirType::Void,
    );
    func.blocks.push(Block {
        params: Vec::new(),
        ops: vec![object, input, store],
        terminator: Terminator::Return(None),
    });
    super::collect(&mut func);
    assert_eq!(func.blocks[0].ops, [object, input, store]);
}

#[test]
fn empty_block_construction_and_retention_work_is_counted() {
    for n in [16, 64, 256] {
        let mut func = function();
        for at in 0..n {
            func.blocks.push(Block {
                params: Vec::new(),
                ops: Vec::new(),
                terminator: if at + 1 == n {
                    Terminator::Return(None)
                } else {
                    Terminator::Jump {
                        target: BlockId(at + 1),
                        args: Vec::new(),
                    }
                },
            });
        }
        super::work::reset();
        super::collect(&mut func);
        let work = super::work::take();
        assert_eq!(work[super::work::Counter::Block as usize], 5 * u64::from(n));
        assert_eq!(work.iter().skip(1).sum::<u64>(), 0);
        eprintln!("empty blocks={n} work={work:?}");
    }
}

#[test]
fn malformed_edge_arity_is_preserved_for_the_verifier() {
    let mut func = alternating(1, true);
    let Terminator::Jump { args, .. } = &mut func.blocks[0].terminator else {
        panic!("entry edge")
    };
    args.push(args[0]);
    super::collect(&mut func);
    assert_eq!(func.blocks[1].params.len(), 1);
    assert!(matches!(&func.blocks[0].terminator, Terminator::Jump { args, .. } if args.len() == 2));
}

#[test]
fn the_operation_only_and_parameter_only_entry_points_keep_their_contracts() {
    let mut func = alternating(1, false);
    let before_ops = func
        .blocks
        .iter()
        .map(|block| block.ops.clone())
        .collect::<Vec<_>>();
    assert_eq!(super::prune_parameters(&mut func), 0);
    assert_eq!(
        func.blocks
            .iter()
            .map(|block| block.ops.clone())
            .collect::<Vec<_>>(),
        before_ops
    );
    assert_eq!(super::eliminate(&mut func), 1);
    assert_eq!(func.blocks[1].params.len(), 1);
}
