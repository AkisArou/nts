//! Count actual work for wide optional records, including unknown owners and
//! aliases inherited by a child. No timing claim or frontend approximation.
#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::{JvmProgram, hierarchy};
use nts_core::hir::{
    self, Block, Field, HirType, Layout, ManagedType, Op, OpKind, Program, Terminator, ValueId,
};
use nts_semantic_schema::TypeId;
#[path = "../../../test-support/optional.rs"]
mod fixture;

const REPEATS: usize = 4;
fn object(ty: u32) -> HirType {
    HirType::Managed(ManagedType::Object(TypeId(ty)))
}

fn program(fields: usize) -> Program {
    let ty = fixture::optional(&HirType::Int {
        bits: 32,
        signed: true,
    });
    let owner = Layout {
        types: vec![TypeId(0), TypeId(10)],
        name: "WideOwner".into(),
        fields: (0..fields)
            .map(|at| Field {
                name: format!("f{at}").into(),
                ty: ty.clone(),
                written: None,
                declared_by: Some(TypeId(10)),
                readonly: false,
            })
            .collect(),
        methods: vec![],
        interfaces: vec![],
        base: None,
    };
    let child = Layout {
        types: vec![TypeId(1)],
        name: "WideChild".into(),
        fields: owner.fields.clone(),
        methods: vec![],
        interfaces: vec![],
        base: Some(TypeId(0)),
    };
    let mut program = Program {
        layouts: vec![owner, child],
        ..Program::default()
    };
    for (name, receiver) in [("throughAlias", 10), ("throughChild", 1)] {
        let mut func = fixture::program().funcs.remove(0);
        func.name = name.into();
        func.return_type = HirType::Void;
        func.params.truncate(1);
        func.params[0].ty = object(receiver);
        func.values = vec![fixture::op(OpKind::Param(0), object(receiver))];
        func.blocks = vec![Block {
            params: vec![],
            ops: vec![ValueId(0)],
            terminator: Terminator::Return(None),
        }];
        for _ in 0..REPEATS {
            for at in 0..fields {
                let read = ValueId(u32::try_from(func.values.len()).unwrap());
                let field = u32::try_from(at).unwrap();
                func.values.push(Op {
                    kind: OpKind::FieldGet {
                        object: ValueId(0),
                        field,
                    },
                    ty: ty.clone(),
                    origin: fixture::origin(),
                });
                func.blocks[0].ops.push(read);
                let store = ValueId(u32::try_from(func.values.len()).unwrap());
                func.values.push(fixture::op(
                    OpKind::FieldSet {
                        object: ValueId(0),
                        field,
                        value: read,
                    },
                    HirType::Void,
                ));
                func.blocks[0].ops.push(store);
            }
        }
        program.funcs.push(func);
    }
    program.public_api = program
        .funcs
        .iter()
        .map(|f| (f.name.clone(), f.name.clone()))
        .collect();
    program
}
fn print(fields: usize, phase: &str, counts: hierarchy::field_cost::Counts) {
    println!(
        "FIELD_COST fields={fields} repeats={REPEATS} phase={phase} name_requests={} name_materializations={} prefix_visits={} owner_requests={} owner_steps={} index_visits={}",
        counts.name_requests,
        counts.name_materializations,
        counts.prefix_visits,
        counts.owner_requests,
        counts.owner_steps,
        counts.index_visits
    );
}
#[test]
fn wide_optional_fields_count_actual_naming_and_owner_work() {
    for fields in [16, 64, 256] {
        let program = program(fields);
        assert_eq!(hir::verify::verify(&program), Ok(()));
        hierarchy::field_cost::reset();
        let emitted = crate::emit(&program);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        let counts = hierarchy::field_cost::get();
        print(fields, "emission", counts);
        assert_eq!(
            counts.name_materializations,
            fields * 2,
            "spell each source field once, including the inherited view"
        );
        assert_eq!(counts.prefix_visits, 0, "a lookup must not scan a prefix");
        assert_eq!(
            counts.owner_steps,
            fields * 3,
            "resolve base and inherited owners once"
        );
        let owner = emitted
            .classes
            .iter()
            .find(|class| class.binary_name == "nts/gen/WideOwner")
            .expect("the field owner was emitted");
        let parsed = nts_jvm_emitter::read::class_file(&owner.bytes).expect("owner class");
        assert_eq!(
            parsed.fields.len(),
            fields * 2,
            "emit every payload and defined component"
        );
        let facts = JvmProgram::new(&program);
        let absent = program.layouts[0].clone();
        hierarchy::field_cost::reset();
        for _ in 0..REPEATS {
            for at in 0..fields {
                assert!(facts.index(&absent).is_none());
                assert!(facts.field_defined_name(&absent, at).is_none());
                let owner = hierarchy::declares_field(&facts, &program.layouts[1], at);
                assert!(std::ptr::eq(owner, &raw const program.layouts[0]));
                assert_eq!(hierarchy::field_name(&facts, owner, at), format!("n$f{at}"));
                assert!(facts.field_defined_name(owner, at).is_some());
            }
        }
        let counts = hierarchy::field_cost::get();
        print(fields, "queries", counts);
        assert_eq!(
            counts.name_materializations, 0,
            "queries consume existing names"
        );
        assert_eq!(
            counts.prefix_visits, 0,
            "absent queries must not trigger a prefix scan"
        );
        assert_eq!(counts.owner_steps, 0, "queries consume existing owners");
    }
}

fn deep_program(classes: usize, declared: bool) -> Program {
    let field = Field {
        name: "only".into(),
        ty: fixture::optional(&HirType::Int {
            bits: 32,
            signed: true,
        }),
        written: None,
        declared_by: declared.then_some(TypeId(1000)),
        readonly: false,
    };
    let mut layouts: Vec<_> = (0..classes)
        .map(|at| Layout {
            types: if at == 0 {
                vec![TypeId(0), TypeId(1000)]
            } else {
                vec![TypeId(u32::try_from(at).unwrap())]
            },
            name: format!("Chain{at}"),
            fields: vec![field.clone()],
            methods: vec![],
            interfaces: vec![],
            base: at
                .checked_sub(1)
                .map(|parent| TypeId(u32::try_from(parent).unwrap())),
        })
        .collect();
    for name in ["Unrelated", "Flattened"] {
        layouts.push(Layout {
            types: vec![TypeId(u32::try_from(layouts.len()).unwrap())],
            name: name.into(),
            fields: vec![Field {
                declared_by: Some(TypeId(1000)),
                ..field.clone()
            }],
            methods: vec![],
            interfaces: vec![],
            base: None,
        });
    }
    let mut program = Program {
        layouts,
        ..Program::default()
    };
    // Equal-sized records are flattened, not JVM subclasses: a source parent
    // alone cannot make a declaring-owner selection valid.
    program
        .record_parents
        .insert(TypeId(u32::try_from(classes + 1).unwrap()), TypeId(0));
    program
}

#[test]
fn deep_one_slot_records_count_owner_construction() {
    let mut extra_work = Vec::new();
    for classes in [16, 64, 256] {
        for declared in [false, true] {
            let program = deep_program(classes, declared);
            assert_eq!(hir::verify::verify(&program), Ok(()));
            hierarchy::field_cost::reset();
            let facts = JvmProgram::new(&program);
            let construction = hierarchy::field_cost::get();
            println!(
                "DEEP_FIELD_COST layouts={classes} declared={declared} phase=construction owner_steps={} name_materializations={} index_visits={}",
                construction.owner_steps,
                construction.name_materializations,
                construction.index_visits
            );
            if construction.owner_steps != classes * 2 + 1 {
                extra_work.push((classes, declared, construction.owner_steps));
            }
            assert_eq!(construction.name_materializations, classes + 2);
            hierarchy::field_cost::reset();
            for _ in 0..REPEATS {
                for at in 0..classes {
                    let owner = hierarchy::declares_field(&facts, &program.layouts[at], 0);
                    assert!(std::ptr::eq(owner, &raw const program.layouts[0]));
                }
                for at in [classes, classes + 1] {
                    let owner = hierarchy::declares_field(&facts, &program.layouts[at], 0);
                    assert!(
                        std::ptr::eq(owner, &raw const program.layouts[at]),
                        "non-ancestor source ownership cannot select storage"
                    );
                }
            }
            let queries = hierarchy::field_cost::get();
            println!(
                "DEEP_FIELD_COST layouts={classes} declared={declared} phase=queries owner_steps={} name_materializations={} index_visits={}",
                queries.owner_steps, queries.name_materializations, queries.index_visits
            );
            assert_eq!(queries.owner_steps, 0);
        }
    }
    assert!(
        extra_work.is_empty(),
        "owner construction must consume one slot and one parent fact: {extra_work:?}"
    );
}

#[test]
fn source_owner_and_fallback_are_independent_of_layout_order() {
    let mut program = deep_program(3, false);
    // A nearer explicit owner does not change the base-most fallback used by
    // the next synthesized inherited field.
    program.layouts[1].fields[0].declared_by = Some(TypeId(1));
    program.layouts.reverse();
    assert_eq!(hir::verify::verify(&program), Ok(()));
    let facts = JvmProgram::new(&program);
    let base = facts.layout(TypeId(0)).unwrap();
    let child = facts.layout(TypeId(1)).unwrap();
    let grandchild = facts.layout(TypeId(2)).unwrap();
    assert!(std::ptr::eq(
        hierarchy::declares_field(&facts, child, 0),
        child
    ));
    assert!(std::ptr::eq(
        hierarchy::declares_field(&facts, grandchild, 0),
        base
    ));
    for id in [3, 4] {
        let flattened = facts.layout(TypeId(id)).unwrap();
        assert!(std::ptr::eq(
            hierarchy::declares_field(&facts, flattened, 0),
            flattened
        ));
    }
}
