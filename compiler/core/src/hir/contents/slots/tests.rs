use super::{Aliases, Fresh, Returned, Slot, freshness};
use crate::hir::{self, Func, OpKind, ValueId};
use crate::hir::{Absent, Block, Callee, HirType, Op, Param, Terminator};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{Origin, TypeId};
use rustc_hash::{FxHashMap, FxHashSet};

fn fixture() -> Func {
    let origin = Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    });
    let object = HirType::Managed(hir::ManagedType::Object(TypeId(1)));
    let mut func = Func {
        name: "slots".to_owned(),
        params: Vec::new(),
        return_type: object.clone(),
        written_return: None,
        validation: None,
        written_return_elements: Vec::new(),
        result_absent: Absent::Impossible,
        values: Vec::new(),
        blocks: Vec::new(),
        origin: origin.clone(),
        exported: false,
        raises: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: FxHashMap::default(),
    };
    for (kind, ty) in [
        (OpKind::Param(0), object.clone()),
        (OpKind::Param(1), object.clone()),
        (OpKind::ConstNull, object.clone()),
        (
            OpKind::FieldSet {
                object: ValueId(0),
                field: 0,
                value: ValueId(2),
            },
            HirType::Void,
        ),
        (
            OpKind::FieldSet {
                object: ValueId(1),
                field: 0,
                value: ValueId(1),
            },
            HirType::Void,
        ),
        (OpKind::BlockParam(0), object.clone()),
        (OpKind::ConstBool(true), HirType::Bool),
        (
            OpKind::Call {
                callee: Callee::External("unknown".to_owned()),
                args: Vec::new(),
                frame: None,
            },
            HirType::Void,
        ),
    ] {
        func.values.push(Op {
            kind,
            ty,
            origin: origin.clone(),
        });
    }
    func.params = vec![
        Param {
            name: "a".into(),
            ty: object.clone(),
            origin: origin.clone(),
            shape: hir::ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
            written: None,
        },
        Param {
            name: "b".into(),
            ty: object,
            origin,
            shape: hir::ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
            written: None,
        },
    ];
    func
}

fn observe(state: &mut Fresh, func: &Func, id: u32) {
    let id = ValueId(id);
    state.observe(
        func,
        id,
        &func.value(id).kind,
        &FxHashSet::default(),
        &Returned::default(),
        &Aliases::of(func),
    );
}

#[test]
fn explicit_null_is_killed_by_a_write_through_an_unknown_alias() {
    let func = fixture();
    let mut state = Fresh::default();
    observe(&mut state, &func, 3);
    assert!(state.known_zero(ValueId(0), Slot::Field(0)));
    observe(&mut state, &func, 4);
    assert!(!state.known_zero(ValueId(0), Slot::Field(0)));
}

#[test]
fn an_open_call_without_arguments_can_still_mutate_an_aliased_field() {
    let func = fixture();
    let mut state = Fresh::default();
    observe(&mut state, &func, 3);
    observe(&mut state, &func, 7);
    assert!(!state.known_zero(ValueId(0), Slot::Field(0)));
}

#[test]
fn fields_and_array_elements_have_separate_slot_keys() {
    let mut state = Fresh::default();
    state.zero.insert(ValueId(0), Slot::Field(0));
    assert!(state.known_zero(ValueId(0), Slot::Field(0)));
    assert!(!state.known_zero(ValueId(0), Slot::Element(0)));
}

#[test]
fn a_phi_rebinds_the_fact_and_drops_the_previous_iterations_value() {
    let func = fixture();
    let mut state = Fresh::default();
    observe(&mut state, &func, 3);
    let carried = state.across(&[ValueId(5)], &[ValueId(0)], &Aliases::of(&func));
    assert!(carried.known_zero(ValueId(5), Slot::Field(0)));
    let rebound = carried.across(&[ValueId(5)], &[ValueId(1)], &Aliases::of(&func));
    assert!(!rebound.known_zero(ValueId(5), Slot::Field(0)));
}

fn forwarded_fresh_fixture() -> Func {
    let mut func = fixture();
    func.values[0].kind = OpKind::ObjectNew { frame: false };
    func.values[4].kind = OpKind::FieldSet {
        object: ValueId(5),
        field: 0,
        value: ValueId(1),
    };
    func.blocks = vec![
        Block {
            params: Vec::new(),
            ops: vec![ValueId(0), ValueId(1)],
            terminator: Terminator::Jump {
                target: hir::BlockId(1),
                args: vec![ValueId(0)],
            },
        },
        Block {
            params: vec![ValueId(5)],
            ops: vec![ValueId(5), ValueId(4)],
            terminator: Terminator::Return(Some(ValueId(0))),
        },
    ];
    func
}

#[test]
fn a_store_through_a_forwarded_fresh_base_invalidates_its_original_name() {
    let func = forwarded_fresh_fixture();
    let mut state = Fresh::default();
    observe(&mut state, &func, 0);
    let mut carried = state.across(&[ValueId(5)], &[ValueId(0)], &Aliases::of(&func));
    assert!(carried.known_zero(ValueId(0), Slot::Field(0)));
    assert!(carried.known_zero(ValueId(5), Slot::Field(0)));
    observe(&mut carried, &func, 4);
    assert!(
        !carried.known_zero(ValueId(0), Slot::Field(0)),
        "the original allocation and its phi name can alias"
    );
}

#[test]
fn allocating_again_separates_the_new_value_from_the_previous_phi_identity() {
    let func = forwarded_fresh_fixture();
    let mut state = Fresh::default();
    observe(&mut state, &func, 0);
    let mut carried = state.across(&[ValueId(5)], &[ValueId(0)], &Aliases::of(&func));
    // The allocation executes again in the next loop iteration. The phi still
    // names the previous object; it cannot name the object just allocated.
    observe(&mut carried, &func, 0);
    observe(&mut carried, &func, 4);
    assert!(
        carried.known_zero(ValueId(0), Slot::Field(0)),
        "a write to the previous iteration's object cannot populate the new allocation"
    );
}

fn two_phi_fixture() -> Func {
    let mut func = forwarded_fresh_fixture();
    func.values.push(Op {
        kind: OpKind::BlockParam(1),
        ty: func.value(ValueId(0)).ty.clone(),
        origin: func.origin.clone(),
    });
    func.blocks[0].terminator = Terminator::Jump {
        target: hir::BlockId(1),
        args: vec![ValueId(0), ValueId(1)],
    };
    func.blocks[1].params = vec![ValueId(5), ValueId(8)];
    func.blocks[1].terminator = Terminator::Jump {
        target: hir::BlockId(1),
        args: vec![ValueId(8), ValueId(5)],
    };
    func
}

fn field_write(object: u32) -> OpKind {
    OpKind::FieldSet {
        object: ValueId(object),
        field: 0,
        value: ValueId(1),
    }
}

#[test]
fn simultaneous_phi_swap_carries_the_old_identities_before_rebinding() {
    let mut func = two_phi_fixture();
    func.values[1].kind = OpKind::ObjectNew { frame: false };
    let ceiling = Aliases::of(&func);
    let mut state = Fresh::default();
    observe(&mut state, &func, 0);
    observe(&mut state, &func, 1);
    let state = state.across(
        &[ValueId(5), ValueId(8)],
        &[ValueId(0), ValueId(1)],
        &ceiling,
    );
    let mut swapped = state.across(
        &[ValueId(5), ValueId(8)],
        &[ValueId(8), ValueId(5)],
        &ceiling,
    );
    observe(&mut swapped, &func, 4);
    assert!(
        swapped.initializing(&func, &field_write(0)),
        "the other allocation's slot stays null"
    );
    assert!(
        !swapped.initializing(&func, &field_write(1)),
        "the written original must release its old value"
    );
}

#[test]
fn reallocating_one_view_preserves_the_other_views_old_identity() {
    let mut func = two_phi_fixture();
    if let Terminator::Jump { args, .. } = &mut func.blocks[0].terminator {
        *args = vec![ValueId(0), ValueId(0)];
    }
    let ceiling = Aliases::of(&func);
    let mut state = Fresh::default();
    observe(&mut state, &func, 0);
    let mut state = state.across(
        &[ValueId(5), ValueId(8)],
        &[ValueId(0), ValueId(0)],
        &ceiling,
    );
    observe(&mut state, &func, 0);
    observe(&mut state, &func, 4);
    assert!(
        state.initializing(&func, &field_write(0)),
        "the allocation creates a new null slot"
    );
    assert!(
        !state.initializing(&func, &field_write(8)),
        "the surviving old view keeps its release"
    );
}

#[test]
fn a_branch_allocation_meeting_an_occupied_older_alias_keeps_its_release() {
    let mut func = two_phi_fixture();
    func.values[1].kind = OpKind::ObjectNew { frame: false };
    // The join's first parameter can be either allocation.
    func.blocks[0].terminator = Terminator::Branch {
        cond: ValueId(6),
        then_target: hir::BlockId(1),
        then_args: vec![ValueId(0), ValueId(1)],
        else_target: hir::BlockId(1),
        else_args: vec![ValueId(1), ValueId(0)],
    };
    let ceiling = Aliases::of(&func);
    let mut older = Fresh::default();
    observe(&mut older, &func, 0);
    older.observe(
        &func,
        ValueId(4),
        &field_write(0),
        &FxHashSet::default(),
        &Returned::default(),
        &ceiling,
    );
    let mut allocated = older.clone();
    observe(&mut allocated, &func, 1);
    let new_path = allocated.across(&[ValueId(5)], &[ValueId(1)], &ceiling);
    let old_path = older.across(&[ValueId(5)], &[ValueId(0)], &ceiling);
    let joined = new_path.both(&old_path);
    assert!(
        !joined.initializing(&func, &field_write(5)),
        "the older occupied path must keep its old-value release"
    );
}

#[test]
fn escaping_a_forwarded_fresh_base_gives_up_its_whole_component() {
    let mut func = forwarded_fresh_fixture();
    func.values[7].kind = OpKind::Call {
        callee: Callee::External("unknown".into()),
        args: vec![ValueId(5)],
        frame: None,
    };
    let mut state = Fresh::default();
    observe(&mut state, &func, 0);
    let mut carried = state.across(&[ValueId(5)], &[ValueId(0)], &Aliases::of(&func));
    observe(&mut carried, &func, 7);
    assert!(!carried.known_zero(ValueId(0), Slot::Field(0)));
}

#[test]
fn an_indexed_write_invalidates_forwarded_fresh_slots_too() {
    let mut func = forwarded_fresh_fixture();
    func.values[6].kind = OpKind::ConstInt(0);
    func.values[4].kind = OpKind::ArraySet {
        array: ValueId(5),
        index: ValueId(6),
        value: ValueId(1),
        checked: true,
    };
    let mut state = Fresh::default();
    observe(&mut state, &func, 0);
    let mut carried = state.across(&[ValueId(5)], &[ValueId(0)], &Aliases::of(&func));
    assert!(carried.known_zero(ValueId(0), Slot::Element(0)));
    observe(&mut carried, &func, 4);
    assert!(!carried.known_zero(ValueId(0), Slot::Element(0)));
    // One difference: an unnameable index destroys authority for every slot.
    func.values[6].kind = OpKind::Param(2);
    observe(&mut carried, &func, 4);
    assert!(!carried.known_zero(ValueId(0), Slot::Element(1)));
}

#[test]
fn every_predecessor_must_establish_the_null_before_a_join() {
    let func = fixture();
    let mut cleared = Fresh::default();
    observe(&mut cleared, &func, 3);
    let unknown = Fresh::default();
    assert!(
        !cleared
            .both(&unknown)
            .known_zero(ValueId(0), Slot::Field(0))
    );
    assert!(
        cleared
            .both(&cleared)
            .known_zero(ValueId(0), Slot::Field(0))
    );
}

#[test]
fn block_storage_order_does_not_make_a_conditional_store_dominate_a_return() {
    let mut func = fixture();
    // Block 2 clears a; block 1 can be reached with or without that clear.
    // The physical block scan used by the old return summary saw the clear.
    func.blocks = vec![
        Block {
            params: Vec::new(),
            ops: vec![ValueId(0), ValueId(1), ValueId(2), ValueId(6)],
            terminator: Terminator::Branch {
                cond: ValueId(6),
                then_target: hir::BlockId(2),
                then_args: Vec::new(),
                else_target: hir::BlockId(1),
                else_args: vec![ValueId(0)],
            },
        },
        Block {
            params: vec![ValueId(5)],
            ops: vec![ValueId(5)],
            terminator: Terminator::Return(Some(ValueId(5))),
        },
        Block {
            params: Vec::new(),
            ops: vec![ValueId(3)],
            terminator: Terminator::Jump {
                target: hir::BlockId(1),
                args: vec![ValueId(0)],
            },
        },
    ];
    let analysis = freshness(
        &func,
        &[],
        &FxHashSet::default(),
        &FxHashSet::default(),
        &Returned::default(),
        &Aliases::of(&func),
    );
    assert!(!analysis.entering[1].known_zero(ValueId(5), Slot::Field(0)));
    // One difference: both paths run the clear before joining.
    if let Terminator::Branch {
        else_target,
        else_args,
        ..
    } = &mut func.blocks[0].terminator
    {
        *else_target = hir::BlockId(2);
        else_args.clear();
    }
    let analysis = freshness(
        &func,
        &[],
        &FxHashSet::default(),
        &FxHashSet::default(),
        &Returned::default(),
        &Aliases::of(&func),
    );
    assert!(analysis.entering[1].known_zero(ValueId(5), Slot::Field(0)));
}

#[test]
fn only_closed_roots_prune_a_new_borrowed_adapter_before_counting() {
    use camino::Utf8Path;
    use hir::reachable::OwnedRoots;
    use nts_frontend_ts::Frontend;

    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-direct-call-hands-an-argument-to-a-published-method/tsconfig.json")
        .canonicalize_utf8()
        .expect("the publication controls are checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the publication snapshot captures");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let mut base = hir::prepare_with(
        &snapshot,
        &hir::Options::new(hir::backend::Backend::C, hir::EntryUnwind::Terminal),
    )
    .expect("the publication controls prepare before counting")
    .program;
    // Entry materialization runs before native dispatch planning. The NoGC
    // preparation supplies its producer graph; discard that later cache before
    // exercising the pre-count root boundary directly.
    base.native_dispatch = None;
    let entries = vec!["direct".to_owned(), "module#init".to_owned()];
    for (label, roots) in [
        ("unknown", None),
        ("every-export", Some(OwnedRoots::EveryExport)),
        ("open", Some(OwnedRoots::Declared(entries.clone()))),
        ("entry", Some(OwnedRoots::Entry(entries))),
    ] {
        let mut program = base.clone();
        program.roots = roots;
        let provided = hir::provide(&mut program, hir::Memory::ReferenceCounting)
            .expect("counting accepts the chosen root contract");
        program.provider = hir::Memory::ReferenceCounting;
        assert!(provided.entry_decisions.iter().any(|decision| {
            decision.kind == hir::own::EntryDecisionKind::Implementation
                && hir::own::source_name(&decision.function) == "publish"
        }));
        // --nocapture makes the real program bytes available for the committed
        // prune-isolation control; ordinary test runs retain captured output.
        println!("ROOT-PROOF-BEGIN {label}\n{program:#?}\nROOT-PROOF-END {label}");
        let names: FxHashSet<_> = program
            .funcs
            .iter()
            .map(|func| func.name.as_str())
            .collect();
        if label == "entry" {
            assert!(names.contains("direct"));
            assert!(names.contains("@consuming:publish"));
            assert!(
                !names.contains("publish"),
                "a closed caller reaches only the private body"
            );
        } else {
            for func in &base.funcs {
                assert!(
                    names.contains(func.name.as_str()),
                    "{label} must retain source entry {}",
                    func.name
                );
            }
        }
    }
}

fn an_unattributable_writer_kills_the_null(kind: OpKind) {
    let mut func = fixture();
    let id = ValueId(u32::try_from(func.values.len()).expect("small fixture"));
    func.values.push(Op {
        kind,
        ty: HirType::Void,
        origin: func.origin.clone(),
    });
    let mut state = Fresh::default();
    observe(&mut state, &func, 3);
    assert!(state.known_zero(ValueId(0), Slot::Field(0)));
    state.observe(
        &func,
        id,
        &func.value(id).kind,
        &FxHashSet::default(),
        &Returned::default(),
        &Aliases::of(&func),
    );
    assert!(!state.known_zero(ValueId(0), Slot::Field(0)));
}

#[test]
fn an_open_field_store_kills_the_null() {
    an_unattributable_writer_kills_the_null(OpKind::OpenFieldSet {
        object: ValueId(1),
        arms: vec![hir::FieldArm {
            ty: TypeId(1),
            field: 0,
        }],
        value: ValueId(1),
    });
}

#[test]
fn a_native_store_kills_the_null() {
    an_unattributable_writer_kills_the_null(OpKind::NativeStore {
        pointer: ValueId(1),
        index: ValueId(6),
        value: ValueId(1),
    });
}

#[test]
fn a_native_bit_store_kills_the_null() {
    an_unattributable_writer_kills_the_null(OpKind::NativeBitStore {
        pointer: ValueId(1),
        field: 0,
        value: ValueId(1),
    });
}

#[test]
fn a_native_copy_kills_the_null() {
    an_unattributable_writer_kills_the_null(OpKind::NativeCopy {
        destination: ValueId(1),
        source: ValueId(0),
    });
}
