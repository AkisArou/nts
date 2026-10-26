//! Actual producer controls for reuse by original entry and contract identity.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{Origin, TypeId};

use super::{guard_slots, missing_callee};
use crate::hir::{
    Absent, Block, Callee, Func, HirType, Layout, ManagedType, Op, OpKind, Param, ParamShape,
    Program, Terminator, facts::Facts,
};

const ORIGINAL: &str = "Derived#run";

fn contract(name: &str) -> Func {
    let origin = Origin::source(Location {
        file: SourceId(0),
        span: Span::new(10, 20),
    });
    let param = Param {
        name: "this".into(),
        ty: HirType::Managed(ManagedType::Object(TypeId(0))),
        origin: origin.clone(),
        shape: ParamShape::Ordinary,
        known: Facts::TOP,
        written: None,
    };
    Func {
        name: name.into(),
        params: vec![param],
        return_type: HirType::Void,
        written_return: None,
        written_return_elements: Vec::new(),
        result_absent: Absent::Impossible,
        values: vec![Op {
            kind: OpKind::Param(0),
            ty: HirType::Managed(ManagedType::Object(TypeId(0))),
            origin: origin.clone(),
        }],
        blocks: vec![Block {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: Terminator::Return(None),
        }],
        origin,
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
    }
}

fn layout(name: &str, receiver: u32, methods: &[&str], base: Option<TypeId>) -> Layout {
    Layout {
        name: name.into(),
        types: vec![TypeId(receiver)],
        fields: Vec::new(),
        methods: methods.iter().map(|name| Some((*name).into())).collect(),
        base,
        interfaces: Vec::new(),
    }
}

fn fixture() -> Program {
    Program {
        funcs: vec![contract("Base#run")],
        layouts: vec![
            layout("Base", 0, &["Base#run", "Base#run"], None),
            layout("Derived", 1, &[ORIGINAL, ORIGINAL], Some(TypeId(0))),
        ],
        uncompiled: vec![(ORIGINAL.into(), "first cause".into())],
        ..Program::default()
    }
}

fn entry(program: &Program, owner: usize, slot: usize) -> &Func {
    let name = program.layouts[owner].methods[slot].as_ref().unwrap();
    program
        .funcs
        .iter()
        .find(|func| func.name == *name)
        .unwrap()
}

fn message(func: &Func) -> &str {
    let OpKind::ConstString(message) = &func.values[func.blocks[0].ops[0].0 as usize].kind else {
        panic!("actual guarded named stop")
    };
    message.as_utf8().unwrap()
}

fn assert_original_absent(program: &Program) {
    assert!(!program.funcs.iter().any(|func| func.name == ORIGINAL));
    let present = program.funcs.iter().map(|func| func.name.clone()).collect();
    assert_eq!(
        missing_callee(&Callee::Direct(ORIGINAL.into()), &present),
        Some(ORIGINAL)
    );
    assert!(
        program.identity_projections.is_empty(),
        "reuse publishes no alias proof"
    );
}

#[test]
fn the_same_receiver_original_and_contract_reuses_one_named_stop() {
    let mut program = fixture();
    program
        .uncompiled
        .push((ORIGINAL.into(), "later different cause".into()));
    guard_slots(&mut program);
    assert_eq!(
        program.funcs.len(),
        2,
        "one live contract plus one guarded source entry"
    );
    let one = entry(&program, 1, 0);
    let two = entry(&program, 1, 1);
    assert_eq!(one.name, two.name);
    assert_eq!(message(one), "`Derived#run` was refused: first cause");
    assert_eq!(
        one.params[0].ty,
        HirType::Managed(ManagedType::Object(TypeId(1)))
    );
    let proof = program
        .guarded_dispatch
        .get(&one.name)
        .expect("actual producer certificate");
    assert_eq!(proof.original, ORIGINAL);
    assert_eq!(proof.contract, "Base#run");
    assert_eq!(proof.receiver, TypeId(1));
    assert_eq!(proof.slots, [0, 1].into());
    assert_original_absent(&program);
}

#[test]
fn different_originals_with_the_same_contract_and_cause_keep_distinct_stops() {
    let mut program = fixture();
    program.layouts[1].methods[1] = Some("Other#run".into());
    program
        .uncompiled
        .push(("Other#run".into(), "first cause".into()));
    guard_slots(&mut program);
    let one = entry(&program, 1, 0);
    let two = entry(&program, 1, 1);
    assert_ne!(one.name, two.name);
    assert_eq!(message(one), "`Derived#run` was refused: first cause");
    assert_eq!(message(two), "`Other#run` was refused: first cause");
    assert_original_absent(&program);
}

#[test]
fn different_chosen_contracts_with_equal_machine_types_are_not_reused() {
    let mut program = fixture();
    let mut second = contract("Base#second");
    second.result_absent = Absent::Undefined;
    program.funcs.push(second);
    program.layouts[0].methods[1] = Some("Base#second".into());
    guard_slots(&mut program);
    let one = entry(&program, 1, 0);
    let two = entry(&program, 1, 1);
    assert_ne!(one.name, two.name);
    assert_eq!(one.params[0].ty, two.params[0].ty);
    assert_eq!(one.return_type, two.return_type);
    assert_eq!(message(one), message(two));
    assert_ne!(
        one.result_absent, two.result_absent,
        "actual distinct contract metadata retained"
    );
    assert_original_absent(&program);
}

#[test]
fn the_same_original_and_contract_on_different_receivers_is_not_reused() {
    let mut program = fixture();
    program.layouts.push(layout(
        "OtherReceiver",
        2,
        &[ORIGINAL, ORIGINAL],
        Some(TypeId(0)),
    ));
    guard_slots(&mut program);
    let one = entry(&program, 1, 0);
    let two = entry(&program, 2, 0);
    assert_ne!(one.name, two.name);
    assert_eq!(
        one.params[0].ty,
        HirType::Managed(ManagedType::Object(TypeId(1)))
    );
    assert_eq!(
        two.params[0].ty,
        HirType::Managed(ManagedType::Object(TypeId(2)))
    );
    assert_eq!(message(one), message(two));
    assert_original_absent(&program);
}

#[test]
fn dead_renamed_and_retargeted_guard_certificates_are_removed() {
    let mut program = fixture();
    guard_slots(&mut program);
    let name = entry(&program, 1, 0).name.clone();
    program.layouts[1].methods[1] = Some("Base#run".into());
    super::retain_guarded(&mut program);
    assert_eq!(program.guarded_dispatch[&name].slots, [0].into());
    let mut renamed = program.clone();
    renamed
        .funcs
        .iter_mut()
        .find(|func| func.name == name)
        .unwrap()
        .name = "renamed".into();
    renamed.layouts[1].methods[0] = Some("renamed".into());
    super::retain_guarded(&mut renamed);
    assert!(
        renamed.guarded_dispatch.is_empty(),
        "renamed body has no inferred certificate"
    );
    program.funcs.retain(|func| func.name != "Base#run");
    super::retain_guarded(&mut program);
    assert!(
        program.guarded_dispatch.is_empty(),
        "missing chosen contract revokes optional provenance"
    );
}
