//! Pure downstream controls: producer identity authority is observed separately
//! in the actual normal-stream witness. No snapshot or bytecode-equivalence rule.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::{JvmProgram, emit, identity_forwarder_target};
use nts_core::hir::{
    Absent, Block, Callee, Func, HirType, Layout, ManagedType, Op, OpKind, Param, ParamShape,
    Program, Terminator, ValueId, facts::Facts,
};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{Origin, TypeId};

const DIRECT: &str = "Example#step";
const ADAPTER: &str = "Example#step@Face";

fn function(name: &str, receiver: TypeId, calls: Option<&str>) -> Func {
    let origin = Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 0),
    });
    let params: Vec<_> = [
        HirType::Managed(ManagedType::Object(receiver)),
        HirType::Erased,
    ]
    .into_iter()
    .enumerate()
    .map(|(at, ty)| Param {
        name: format!("p{at}"),
        ty,
        written: None,
        origin: origin.clone(),
        shape: ParamShape::Ordinary,
        known: Facts::TOP,
    })
    .collect();
    let mut values: Vec<_> = params
        .iter()
        .enumerate()
        .map(|(at, param)| Op {
            kind: OpKind::Param(u32::try_from(at).unwrap()),
            ty: param.ty.clone(),
            origin: origin.clone(),
        })
        .collect();
    let returned = if let Some(target) = calls {
        values.push(Op {
            kind: OpKind::Call {
                callee: Callee::Direct(target.into()),
                args: vec![ValueId(0), ValueId(1)],
                frame: None,
            },
            ty: HirType::Erased,
            origin: origin.clone(),
        });
        ValueId(2)
    } else {
        ValueId(1)
    };
    Func {
        name: name.into(),
        params,
        return_type: HirType::Erased,
        written_return: None,
        written_return_elements: Vec::new(),
        result_absent: Absent::Undefined,
        blocks: vec![Block {
            params: Vec::new(),
            ops: (0..values.len())
                .map(|at| ValueId(u32::try_from(at).unwrap()))
                .collect(),
            terminator: Terminator::Return(Some(returned)),
        }],
        values,
        origin,
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
    }
}

fn fixture(reversed: bool) -> Program {
    let mut methods = vec![Some(DIRECT.into()), Some(ADAPTER.into())];
    if reversed {
        methods.reverse();
    }
    Program {
        funcs: vec![
            function("Base#step", TypeId(0), None),
            function(DIRECT, TypeId(1), None),
            function(ADAPTER, TypeId(1), Some(DIRECT)),
            function("another_body", TypeId(1), None),
        ],
        layouts: vec![
            Layout {
                types: vec![TypeId(0)],
                name: "Base".into(),
                fields: Vec::new(),
                methods: vec![Some("Base#step".into()), Some("Base#step".into())],
                base: None,
                interfaces: Vec::new(),
            },
            Layout {
                types: vec![TypeId(1)],
                name: "Example".into(),
                fields: Vec::new(),
                methods,
                base: Some(TypeId(0)),
                interfaces: Vec::new(),
            },
        ],
        identity_projections: [(ADAPTER.into(), DIRECT.into())].into(),
        ..Program::default()
    }
}

fn assert_refused(program: &Program) {
    let emitted = emit(program);
    assert!(
        emitted
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "NTS4001"
                && diagnostic.message.contains("distinct dispatch bodies")),
        "{:?}",
        emitted.diagnostics
    );
    assert!(
        !emitted
            .classes
            .iter()
            .any(|class| class.binary_name == "nts/gen/Example"),
        "unproved bodies shared a JVM member"
    );
}

#[test]
fn recorded_identity_selects_one_direct_body_in_both_slot_orders() {
    let mut outputs = Vec::new();
    for reversed in [false, true] {
        let program = fixture(reversed);
        let emitted = emit(&program);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        let class = emitted
            .classes
            .iter()
            .find(|class| class.binary_name == "nts/gen/Example")
            .unwrap();
        let parsed = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
        let methods: Vec<_> = parsed
            .methods
            .iter()
            .filter(|method| method.name == "step")
            .collect();
        assert_eq!(methods.len(), 1);
        assert_eq!(
            methods[0].descriptor,
            "(Lnts/rt/NtsValue;)Lnts/rt/NtsValue;"
        );
        assert!(
            class
                .bytes
                .windows(b"Example$step".len())
                .any(|bytes| bytes == b"Example$step")
        );
        assert!(
            !class
                .bytes
                .windows(b"Example$step$Face".len())
                .any(|bytes| bytes == b"Example$step$Face"),
            "canonical direct target must be selected, independent of the first slot"
        );
        outputs.push(class.bytes.clone());
    }
    assert_eq!(
        outputs[0], outputs[1],
        "slot order changed emitted body choice"
    );
}

#[test]
fn missing_wrong_and_absence_mismatched_identity_cannot_share_a_member() {
    for reversed in [false, true] {
        let mut missing = fixture(reversed);
        missing.identity_projections.clear();
        assert_refused(&missing);
        let mut wrong = fixture(reversed);
        wrong
            .identity_projections
            .insert(ADAPTER.into(), "another_body".into());
        assert_refused(&wrong);
        let mut absence = fixture(reversed);
        absence
            .funcs
            .iter_mut()
            .find(|func| func.name == ADAPTER)
            .unwrap()
            .result_absent = Absent::Null;
        assert_refused(&absence);
    }
}

#[test]
fn different_machine_contract_or_projection_chain_keeps_its_own_body() {
    let mut descriptor = fixture(false);
    descriptor
        .funcs
        .iter_mut()
        .find(|func| func.name == ADAPTER)
        .unwrap()
        .params[1]
        .ty = HirType::NUMBER;
    let facts = JvmProgram::new(&descriptor);
    let projected = descriptor
        .funcs
        .iter()
        .find(|func| func.name == ADAPTER)
        .unwrap();
    assert_eq!(
        identity_forwarder_target("nts/gen", &facts, projected).name,
        ADAPTER
    );
    let mut shape = fixture(false);
    shape
        .funcs
        .iter_mut()
        .find(|func| func.name == ADAPTER)
        .unwrap()
        .params[1]
        .shape = ParamShape::Optional;
    let facts = JvmProgram::new(&shape);
    let projected = shape
        .funcs
        .iter()
        .find(|func| func.name == ADAPTER)
        .unwrap();
    assert_eq!(
        identity_forwarder_target("nts/gen", &facts, projected).name,
        ADAPTER
    );
    let mut chain = fixture(false);
    chain
        .identity_projections
        .insert(DIRECT.into(), "another_body".into());
    let facts = JvmProgram::new(&chain);
    let projected = chain
        .funcs
        .iter()
        .find(|func| func.name == ADAPTER)
        .unwrap();
    assert_eq!(
        identity_forwarder_target("nts/gen", &facts, projected).name,
        ADAPTER
    );
}

#[test]
fn void_identity_has_no_result_absence_to_convert() {
    for reversed in [false, true] {
        let mut program = fixture(reversed);
        for func in &mut program.funcs {
            func.return_type = HirType::Void;
            func.result_absent = if func.name == ADAPTER {
                Absent::Impossible
            } else {
                Absent::Undefined
            };
            for block in &mut func.blocks {
                block.terminator = Terminator::Return(None);
            }
            for op in &mut func.values {
                if matches!(op.kind, OpKind::Call { .. }) {
                    op.ty = HirType::Void;
                }
            }
        }
        let facts = JvmProgram::new(&program);
        let projected = program
            .funcs
            .iter()
            .find(|func| func.name == ADAPTER)
            .unwrap();
        assert_eq!(
            identity_forwarder_target("nts/gen", &facts, projected).name,
            DIRECT
        );
        let emitted = emit(&program);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        let class = emitted
            .classes
            .iter()
            .find(|class| class.binary_name == "nts/gen/Example")
            .unwrap();
        let parsed = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
        let methods: Vec<_> = parsed
            .methods
            .iter()
            .filter(|method| method.name == "step")
            .collect();
        assert_eq!(methods.len(), 1);
        assert_eq!(methods[0].descriptor, "(Lnts/rt/NtsValue;)V");
    }
}
