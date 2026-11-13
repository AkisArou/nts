use super::super::{Field, Layout, Program};
use super::{MemberKey, TypeId};

#[test]
fn only_the_typed_receiver_fact_proves_its_class_representation() {
    use nts_semantic_schema::{
        NodeId, SemanticSnapshot, SymbolFlags, SymbolId, SymbolRecord, TypeKind, TypeRecord,
    };
    let mut snapshot = SemanticSnapshot::default();
    snapshot.symbols.push(SymbolRecord {
        name: "SameName".to_owned().into(),
        flags: SymbolFlags::CLASS,
        builtin: None,
        declarations: Vec::new(),
        declaration_sites: Vec::new(),
        ty: None,
        aliased: None,
        owner: None,
        constructor_value: None,
        library: None,
    });
    snapshot.types.push(TypeRecord {
        kind: TypeKind::Object {
            properties: Vec::new(),
        },
        symbol: Some(SymbolId(0)),
    });
    for (name, is_this) in [("T", false), ("SameName", false), ("\u{7f}class", true)] {
        snapshot.types.push(TypeRecord {
            kind: TypeKind::TypeParameter {
                name: name.into(),
                constraint: Some(TypeId(0)),
                is_this,
            },
            // Even matching semantic symbol and printed class name do not
            // turn an ordinary constrained parameter into `this`.
            symbol: Some(SymbolId(0)),
        });
    }
    let bound = super::representation(&snapshot, TypeId(0));
    assert!(bound.is_some());
    for at in [TypeId(1), TypeId(2)] {
        assert_eq!(super::representation(&snapshot, at), None);
        assert!(!super::short(&snapshot, at).starts_with("`this`"));
    }
    assert_eq!(super::representation(&snapshot, TypeId(3)), bound);
    assert_eq!(
        super::short(&snapshot, TypeId(3)),
        "`this`, which stands for `SameName` here"
    );
    for at in 1..=3 {
        snapshot.node_types.insert(NodeId(at), TypeId(at));
    }
    let lowering = super::LoweringSnapshot::new(&snapshot);
    let probe = super::FuncBuilder::probe(&lowering);
    for at in 1..=3 {
        assert_eq!(probe.stands_for_its_own_class(NodeId(at)), at == 3);
        assert_eq!(
            probe.class_behind(TypeId(at)),
            if at == 3 { TypeId(0) } else { TypeId(at) }
        );
    }
}

#[test]
fn semantic_computed_numbers_use_javascript_property_spelling() {
    use nts_semantic_schema::{LiteralValue, NodeId, SemanticSnapshot, TypeKind, TypeRecord};
    let mut snapshot = SemanticSnapshot::default();
    for (at, value) in [1e-7, 1e21, -0.0, 1000.0].into_iter().enumerate() {
        let at = u32::try_from(at).expect("four constants");
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Literal(LiteralValue::Number(value)),
            symbol: None,
        });
        snapshot.node_types.insert(NodeId(at), TypeId(at));
    }
    let lowering = super::LoweringSnapshot::new(&snapshot);
    let probe = super::FuncBuilder::probe(&lowering);
    for (at, expected) in ["1e-7", "1e+21", "0", "1000"].into_iter().enumerate() {
        assert_eq!(
            probe
                .constant_member_name(NodeId(u32::try_from(at).expect("four constants")))
                .as_deref(),
            Some(expected)
        );
    }
}

#[test]
fn a_private_template_member_needs_equal_source_arguments_and_storage() {
    use nts_semantic_schema::{
        NodeId, SemanticSnapshot, SymbolFlags, SymbolId, SymbolRecord, TypeKind, TypeRecord,
    };
    let mut snapshot = SemanticSnapshot::default();
    for index in 0..2 {
        snapshot.symbols.push(SymbolRecord {
            builtin: None,
            name: "SameName".to_owned().into(),
            flags: SymbolFlags::CLASS,
            declarations: vec![NodeId(index)],
            declaration_sites: Vec::new(),
            ty: None,
            aliased: None,
            owner: None,
            constructor_value: None,
            library: None,
        });
    }
    for symbol in [0, 0, 1, 0, 0] {
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Object {
                properties: Vec::new(),
            },
            symbol: Some(SymbolId(symbol)),
        });
    }
    for name in ["K", "V"] {
        snapshot.types.push(TypeRecord {
            kind: TypeKind::TypeParameter {
                name: name.to_owned(),
                is_this: false,
                constraint: None,
            },
            symbol: None,
        });
    }
    snapshot
        .type_arguments
        .insert(TypeId(1), vec![TypeId(5), TypeId(6)]);
    snapshot
        .type_arguments
        .insert(TypeId(2), vec![TypeId(5), TypeId(6)]);
    snapshot
        .type_arguments
        .insert(TypeId(4), vec![TypeId(6), TypeId(5)]);
    for kind in [TypeKind::Number, TypeKind::String] {
        snapshot.types.push(TypeRecord { kind, symbol: None });
    }
    snapshot
        .type_arguments
        .insert(TypeId(0), vec![TypeId(7), TypeId(8)]);
    snapshot
        .type_arguments
        .insert(TypeId(3), vec![TypeId(8), TypeId(7)]);
    let snapshot = super::LoweringSnapshot::new(&snapshot);
    let mut probe = super::FuncBuilder::probe(&snapshot);
    let member = |owner| Field {
        name: nts_semantic_schema::PropertyKey::Private("#value".to_owned()),
        ty: super::HirType::NUMBER,
        declared_by: Some(TypeId(owner)),
        readonly: false,
        written: None,
    };
    assert!(
        !probe.one_slot(&member(1), &member(0)),
        "an unbound template"
    );
    probe.sources.insert(TypeId(5), TypeId(7));
    probe.sources.insert(TypeId(6), TypeId(8));
    assert!(probe.one_slot(&member(1), &member(0)));
    assert!(probe.one_slot(&member(0), &member(1)));
    assert!(
        !probe.one_slot(&member(2), &member(0)),
        "different declarations"
    );
    assert!(
        !probe.one_slot(&member(3), &member(0)),
        "two concrete instances"
    );
    assert!(super::is_a_generic_declaration(&snapshot, TypeId(4)));
    assert!(
        !probe.one_slot(&member(4), &member(0)),
        "a permuted template"
    );
    let mut different = member(0);
    different.ty = super::HirType::Bool;
    assert!(!probe.one_slot(&member(1), &different), "different storage");
    different = member(0);
    different.name = nts_semantic_schema::PropertyKey::Private("#other".to_owned());
    assert!(!probe.one_slot(&member(1), &different), "different members");
}

#[test]
#[allow(clippy::unwrap_used, clippy::expect_used)]
fn an_anonymous_field_schema_shares_its_source_supplier_in_either_demand_order() {
    use nts_frontend_ts::Frontend;
    let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/accessor-schema-supplier/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let snapshot = super::LoweringSnapshot::new(&snapshot);
    let foreign = super::NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default);
    let readers =
        super::initialization::PrivateReaders::new(&super::FuncBuilder::probe(&snapshot));
    let closures = super::collect_closures(&snapshot, &readers);
    let (hierarchy, naming) =
        super::hierarchy_and_naming(&snapshot, foreign, &closures, &readers);
    let schemas: Vec<_> = snapshot
        .types
        .iter()
        .enumerate()
        .filter_map(|(at, record)| {
            let super::TypeKind::Object { properties } = &record.kind else {
                return None;
            };
            (properties.len() == 1 && properties[0].name.is_name("destroyed"))
                .then(|| TypeId(u32::try_from(at).unwrap()))
        })
        .collect();
    assert!(
        schemas.len() >= 2,
        "the declaration and literal must be distinct source types"
    );
    for reversed in [false, true] {
        let mut probe = super::FuncBuilder::new(&snapshot, foreign);
        probe.hierarchy = &hierarchy;
        probe.closures = closures.clone().into();
        super::wire_naming(&mut probe, &naming);
        let mut schemas = schemas.clone();
        if reversed {
            schemas.reverse();
        }
        for schema in schemas {
            probe.layout_of(super::NodeId(0), schema).unwrap();
        }
        assert_eq!(
            probe
                .layouts
                .iter()
                .filter(|layout| {
                    layout.fields.len() == 1 && layout.fields[0].name.is_name("destroyed")
                })
                .count(),
            1,
            "schema demand order reversed={reversed}"
        );
    }
}

#[test]
#[allow(clippy::unwrap_used, clippy::expect_used)]
fn anonymous_reservations_survive_layout_demand_order() {
    use nts_frontend_ts::Frontend;
    let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/accessor-schema-order/tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let snapshot = super::LoweringSnapshot::new(&snapshot);
    let foreign = super::NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default);
    let readers =
        super::initialization::PrivateReaders::new(&super::FuncBuilder::probe(&snapshot));
    let closures = super::collect_closures(&snapshot, &readers);
    let (hierarchy, naming) =
        super::hierarchy_and_naming(&snapshot, foreign, &closures, &readers);
    let groups = [["item", "remove"], ["hostname", "port"]];
    let mut faces = Vec::new();
    let mut anonymous = Vec::new();
    for (at, record) in snapshot.types.iter().enumerate() {
        let super::TypeKind::Object { properties } = &record.kind else {
            continue;
        };
        if !groups.iter().any(|group| {
            properties
                .iter()
                .map(|p| p.name.public_name().expect("the fixture has public keys"))
                .eq(*group)
        }) {
            continue;
        }
        let ty = TypeId(u32::try_from(at).unwrap());
        if hierarchy.faces.contains(&ty) {
            faces.push(ty);
        } else if !hierarchy
            .access_families
            .licensed
            .iter()
            .any(|family| family.supplies.iter().any(|supply| supply.owner == ty))
        {
            anonymous.push(ty);
        }
    }
    assert!(
        anonymous.len() >= 2,
        "both inferred callback schemas must be exercised"
    );
    assert!(faces.len() >= 2);
    for anonymous_first in [true, false] {
        let mut probe = super::FuncBuilder::new(&snapshot, foreign);
        probe.hierarchy = &hierarchy;
        probe.closures = closures.clone().into();
        super::wire_naming(&mut probe, &naming);
        let (first, second) = if anonymous_first {
            (&anonymous, &faces)
        } else {
            (&faces, &anonymous)
        };
        for ty in first.iter().chain(second) {
            probe.layout_of(super::NodeId(0), *ty).unwrap();
        }
        for fields in groups {
            let count = probe
                .layouts
                .iter()
                .filter(|layout| {
                    layout
                        .fields
                        .iter()
                        .map(|field| {
                            field
                                .name
                                .public_name()
                                .expect("the fixture has public keys")
                        })
                        .eq(fields)
                })
                .count();
            assert_eq!(count, 1, "anonymous first={anonymous_first}: {fields:?}");
        }
    }
}

fn layout(name: &str, ty: u32, fields: &[&str]) -> Layout {
    Layout {
        types: vec![TypeId(ty)],
        name: name.to_owned(),
        fields: fields
            .iter()
            .map(|field| Field {
                name: (*field).to_owned().into(),
                ty: super::HirType::NUMBER,
                declared_by: None,
                readonly: false,
                written: None,
            })
            .collect(),
        methods: Vec::new(),
        interfaces: Vec::new(),
        base: None,
    }
}

/// One type laid out two ways is recorded, and the same type laid out the
/// same way twice is not.
///
/// **The must-fire arm for a guard whose whole point is a silence.** Two
/// layouts for one type with the same field *names* in a different *order*
/// merge into one, and the merge keeps whichever arrived first -- so every
/// function that indexed the other is wrong by a slot, the struct is the
/// same size, the offset asserts all hold, and clang says nothing. Without
/// the record there is no evidence left by the time anything can look.
///
/// The three negative arms are what say the record is about *order*: a
/// layout reached twice identically is ordinary (`layout_of` is asked from
/// many places and hands back a clone), a different field *set* is a
/// different question `same_shape` already decides, and a different *count*
/// is not a reordering at all.
#[test]
fn one_type_laid_out_two_ways_is_recorded() {
    let mut program = Program::default();
    super::collect_layouts(
        &mut program,
        vec![layout("Resolved", 10, &["depth", "colors"])],
    );
    super::collect_layouts(
        &mut program,
        vec![layout("Resolved", 10, &["colors", "depth"])],
    );
    assert_eq!(
        program.disputed_layouts.len(),
        1,
        "a reorder must be recorded"
    );
    let disputed = &program.disputed_layouts[0];
    assert_eq!(disputed.name, "Resolved");
    assert_eq!(
        disputed.kept,
        ["depth", "colors"],
        "the order that arrived first is kept"
    );
    assert_eq!(
        disputed.discarded,
        ["colors", "depth"],
        "and the one some function indexed by"
    );

    // The same layout twice: ordinary, and the commonest case there is.
    let mut program = Program::default();
    super::collect_layouts(&mut program, vec![layout("Same", 11, &["a", "b"])]);
    super::collect_layouts(&mut program, vec![layout("Same", 11, &["a", "b"])]);
    assert!(
        program.disputed_layouts.is_empty(),
        "one order twice is not a dispute"
    );

    // A different field set is `same_shape`'s question, not this one.
    let mut program = Program::default();
    super::collect_layouts(&mut program, vec![layout("Other", 12, &["a", "b"])]);
    super::collect_layouts(&mut program, vec![layout("Other", 12, &["a", "c"])]);
    assert!(
        program.disputed_layouts.is_empty(),
        "a different name is not a reorder"
    );

    // And a different count is not a reordering either.
    let mut program = Program::default();
    super::collect_layouts(&mut program, vec![layout("Wider", 13, &["a", "b"])]);
    super::collect_layouts(&mut program, vec![layout("Wider", 13, &["a", "b", "c"])]);
    assert!(
        program.disputed_layouts.is_empty(),
        "a different width is not a reorder"
    );
}

/// `verify` reports what the merge recorded.
///
/// Separate from the test above because they are two failures: the merge
/// can record and nothing read it, which is the state every silent defect
/// in this file started from.
#[test]
fn a_disputed_layout_is_reported_by_verify() {
    let mut program = Program::default();
    super::collect_layouts(
        &mut program,
        vec![layout("Resolved", 10, &["depth", "colors"])],
    );
    super::collect_layouts(
        &mut program,
        vec![layout("Resolved", 10, &["colors", "depth"])],
    );
    let problems = super::super::verify::verify(&program).expect_err("a dispute is invalid");
    assert!(
        problems.iter().any(|problem| matches!(
            problem,
            super::super::verify::Invalid::DisputedLayout { .. }
        )),
        "expected a DisputedLayout, got {problems:?}",
    );
}

/// Two dispatch roots that `hierarchy.name` spells alike get one shell.
///
/// The check for "already declared" read `program.funcs` only, and the
/// shells this loop makes are held back until it ends -- so two roots of
/// one name both passed it and both were pushed. `verify` calls that
/// `DuplicateFunction`, `emit-c` calls it "refusing to emit code from
/// invalid HIR", and six of the twenty-six node modules emitted **no
/// output at all** the first time something made two such roots.
///
/// Latent today: nothing in the tree produces two roots of one name. A
/// latent guard is worth what it costs to write, and this one is a test
/// rather than a paragraph because the failure it prevents is silent in
/// the worst way -- the whole module, with a diagnostic naming a function
/// rather than the pass that duplicated it.
#[test]
fn two_roots_of_one_name_declare_one_shell() {
    use super::{Hierarchy, ManagedType};
    use crate::hir::facts::Facts;
    use crate::hir::{Block, Func, Origin, Param, ParamShape, Terminator};
    use nts_diagnostics::{Location, SourceId, Span};

    let here = || {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    };
    let receiver = |ty: u32| super::HirType::Managed(ManagedType::Object(TypeId(ty)));
    let mut hierarchy = Hierarchy::default();
    // Two roots, one name -- the shape a generic instantiation and its
    // declaration make, and the one `implements` inference made in bulk.
    for root in [1_u32, 2] {
        hierarchy.name.insert(TypeId(root), "Sink".to_owned());
        hierarchy
            .declares
            .insert(TypeId(root), vec![MemberKey::named("write")]);
        hierarchy
            .slots
            .insert((TypeId(root), MemberKey::named("write"), false), root - 1);
    }
    // Both roots, in one entry: inserting twice overwrites, and with only
    // the second edge the first root finds no implementer and declares
    // nothing -- so the test passed with the fix sabotaged, which is the
    // hollow arm this file's neighbours keep finding.
    hierarchy
        .implements
        .insert(TypeId(9), vec![TypeId(1), TypeId(2)]);
    // The implementer, whose body both roots would take a shell from.
    let mut program = Program::default();
    program.funcs.push(Func {
        name: "Impl#write".to_owned(),
        params: vec![Param {
            name: "this".to_owned(),
            ty: receiver(9),
            shape: ParamShape::Ordinary,
            origin: here(),
            known: Facts::TOP,
            written: None,
        }],
        return_type: super::HirType::Void,
        values: Vec::new(),
        blocks: vec![Block {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: Terminator::Return(None),
        }],
        origin: here(),
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
        written_return: None,
        result_absent: crate::hir::Absent::Impossible,
        validation: None,
        written_return_elements: Vec::new(),
    });

    program.layouts.push(crate::hir::Layout {
        types: vec![TypeId(9)],
        name: "Impl".to_owned(),
        fields: Vec::new(),
        methods: vec![Some("Impl#write".to_owned()); 2],
        interfaces: vec![TypeId(1), TypeId(2)],
        base: None,
    });
    let snapshot = nts_semantic_schema::SemanticSnapshot::default();
    let snapshot = super::LoweringSnapshot::new(&snapshot);
    let mut collector = super::LayoutCollector::new(std::mem::take(&mut program.layouts));
    super::declare_interface_methods(
        &mut collector,
        &hierarchy,
        &mut super::FuncBuilder::probe(&snapshot),
        &mut program,
    );
    program.layouts = collector.into_layouts();
    let shells = program
        .funcs
        .iter()
        .filter(|func| func.name == "Sink#write")
        .count();
    assert_eq!(
        shells, 1,
        "two roots of one name must declare one shell, not two"
    );
}

/// Two declarations named alike are two layouts named apart, whichever
/// way the second one arrives.
///
/// The push path suffixed a taken name for a year. The **rename on
/// merge** -- a declared name beating a generated one -- adopted it
/// unasked, and that is the order `zlib` produced: `stream/transform.ts`'s
/// 24-field `TransformOptions` pushed first, an anonymous `{ signal }`
/// second, and `stream/iter/pull.ts`'s one-field `TransformOptions`
/// third, merging into the anonymous one by shape and taking a name the
/// first already held. `verify` reported `DuplicateLayout` and the module
/// emitted nothing. Both orders below must end with two distinct names.
#[test]
fn a_second_declaration_of_one_name_is_named_apart_on_merge_too() {
    // The push order the push path already handled.
    let mut program = Program::default();
    super::collect_layouts(&mut program, vec![layout("Options", 1, &["a", "b", "c"])]);
    super::collect_layouts(&mut program, vec![layout("Options", 7, &["signal"])]);
    let names: Vec<&str> = program.layouts.iter().map(|it| it.name.as_str()).collect();
    assert_eq!(names, ["Options", "Options7"]);

    // The merge order that produced the duplicate: the big declared one,
    // then an anonymous shape, then the small declared one that merges
    // into the anonymous shape and would take its declared name.
    let mut program = Program::default();
    super::collect_layouts(&mut program, vec![layout("Options", 1, &["a", "b", "c"])]);
    super::collect_layouts(&mut program, vec![layout("Type5", 5, &["signal"])]);
    super::collect_layouts(&mut program, vec![layout("Options", 7, &["signal"])]);
    let names: Vec<&str> = program.layouts.iter().map(|it| it.name.as_str()).collect();
    assert_eq!(program.layouts.len(), 2, "the two one-field shapes merge");
    assert_eq!(names, ["Options", "Options5"]);
    assert_eq!(program.layouts[1].types, [TypeId(5), TypeId(7)]);

    // And the control: a declared name still beats a generated one where
    // nothing holds it.
    let mut program = Program::default();
    super::collect_layouts(&mut program, vec![layout("Type5", 5, &["signal"])]);
    super::collect_layouts(&mut program, vec![layout("Options", 7, &["signal"])]);
    assert_eq!(program.layouts.len(), 1);
    assert_eq!(program.layouts[0].name, "Options");
}

/// A foreign layout's name is its identity, like the three families beside
/// it in `nominal_name`.
///
/// **The control is the pair that must still merge.** Two field-less
/// TypeScript classes *do* merge today -- measured, `class Alpha {}` and
/// `class Beta {}` produce one layout -- and the JVM emitter repairs that by
/// subclassing. Nothing here should change it. What must not merge is a
/// layout standing for a class we did not lay out, because the repair works
/// by inventing a name and a foreign class's binary name is fixed by its
/// jar.
#[test]
fn a_foreign_layout_name_is_its_identity() {
    assert!(super::is_foreign_name("java/lang/Runnable"));
    assert!(super::is_foreign_name("android/view/View"));
    assert!(super::nominal_name("java/util/Observer"));

    // A TypeScript identifier cannot contain `/`, so no layout of ours is
    // ever mistaken for a foreign one. Without this the rule would stop two
    // ordinary empty classes from merging and cost the subclass repair its
    // whole purpose.
    assert!(!super::is_foreign_name("Alpha"));
    assert!(!super::is_foreign_name("Beta"));
    assert!(!super::nominal_name("Alpha"));
    assert!(!super::nominal_name("Point"));
}

use super::{closure_type, parse_bigint, parse_handle_constant, parse_number};

#[test]
fn native_pointer_constant_bits_are_lossless_and_bounded() {
    for (text, want) in [
        ("65535", 65535),
        ("+32512", 32512),
        ("0x3", 3),
        ("-0", 0),
        ("-1", u64::MAX),
        ("-0x3", u64::MAX - 2),
        ("9007199254740993", 9_007_199_254_740_993),
        ("0x8000000000000000", 1 << 63),
        ("-9223372036854775808", 1 << 63),
        ("18446744073709551615", u64::MAX),
    ] {
        assert_eq!(parse_handle_constant(text), Some(want), "{text}");
    }
    for text in [
        "",
        "0x",
        "1.5",
        "1e3",
        "NaN",
        "1n",
        "++1",
        "-+1",
        "1_000",
        "18446744073709551616",
        "-9223372036854775809",
    ] {
        assert_eq!(parse_handle_constant(text), None, "{text}");
    }
}

#[test]
fn bigint_literal_and_guard_spellings_are_exact() {
    assert_eq!(
        parse_bigint("9_007_199_254_740_993n"),
        Some(9_007_199_254_740_993)
    );
    assert_eq!(
        parse_bigint("0x10000000000000007n"),
        Some((1_i128 << 64) + 7)
    );
    assert_eq!(parse_bigint("-0b101n"), Some(-5));
    assert_eq!(parse_bigint("0o17n"), Some(15));
    assert_eq!(
        parse_bigint("170141183460469231731687303715884105727"),
        Some(i128::MAX)
    );
    assert_eq!(
        parse_bigint("-170141183460469231731687303715884105728"),
        Some(i128::MIN)
    );
    assert_eq!(
        parse_bigint("170141183460469231731687303715884105728n"),
        None
    );
    assert_eq!(parse_bigint(""), None);
}

/// The synthetic id bands do not overlap.
///
/// This is the invariant two comments each asserted and the code broke.
/// `closure_type` counted **down** from `u32::MAX` — "so it cannot collide
/// with anything the snapshot assigned", which is true and is not the whole
/// question — straight into [`super::super::CONSTRUCTOR_TOKENS`], sixteen
/// ids at `u32::MAX - 15`, whose own comment says it is placed there
/// *because closures are numbered upward from `SYNTHETIC_CLOSURES`*.
///
/// So a program's fifteenth closure had the id of `Ctor_Error` and its
/// fourteenth `Ctor_TypeError`, and closures sixteen through thirty-one
/// landed in [`super::super::PROVIDED_ERRORS`]. `Program::layout` finds a
/// layout by asking which one holds the id, so it returned whichever it met
/// first: `runtime/node/async_hooks` emitted a callback as
/// `&nts_fnval_NtsObj_Ctor_TypeError` for a call whose HIR correctly said
/// `const closure.static`.
///
/// **Asserted over the partition rather than over a program**, which is why
/// this is a unit test and not an example. Two backends compile the lie
/// without complaint — the C only failed because the emitted prototype met
/// a hand-written header that disagreed — so no differential can see it, and
/// a program that reproduces it needs sixteen closures *and* a class used as
/// a value, which is a shape nobody writes on purpose.
///
/// The old assertion checked the *floor* of the closure band, which a
/// descending counter passes for half a million closures, and never the
/// ceiling it was walking into. This checks the ceiling.
#[test]
fn no_closure_id_lands_in_a_reserved_band() {
    for index in 0..4096usize {
        let id = closure_type(index).0;
        assert!(
            id >= crate::hir::SYNTHETIC_CLOSURES,
            "closure {index} is below the closure floor: {id}",
        );
        assert!(
            id < crate::hir::PROVIDED_ERRORS,
            "closure {index} reaches the provided-error band: {id}",
        );
        assert!(
            id < crate::hir::CONSTRUCTOR_TOKENS,
            "closure {index} reaches the constructor-token band: {id}",
        );
    }
}

/// And the two reserved bands do not overlap each other.
///
/// Sixteen apart by construction, and stated here so that widening either
/// one has to come past a test rather than past a reader.
#[test]
fn the_reserved_bands_are_disjoint() {
    // Read through a binding so the comparison is not folded at compile
    // time: `assert!(A < B)` on two constants is a constant, and clippy
    // says so -- correctly, because a test that cannot fail is not one.
    let errors = crate::hir::PROVIDED_ERRORS;
    let tokens = crate::hir::CONSTRUCTOR_TOKENS;
    assert!(errors < tokens, "the bands are ordered");
    assert_eq!(
        tokens - errors,
        16,
        "the provided-error band holds sixteen and ends where the tokens begin",
    );
    assert!(
        crate::hir::builtin::ERRORS.len() <= 16,
        "more provided error classes than either band holds",
    );
}

/// Every spelling a JavaScript numeric literal has.
#[test]
fn a_literal_parses_as_the_double_it_denotes() {
    assert_eq!(parse_number("0"), Some(0.0));
    assert_eq!(parse_number("1_000_000"), Some(1_000_000.0));
    assert_eq!(parse_number("1e-320"), Some(1e-320));
    assert_eq!(parse_number("0x1f"), Some(31.0));
    assert_eq!(parse_number("0o17"), Some(15.0));
    assert_eq!(parse_number("0b1011"), Some(11.0));
    assert_eq!(parse_number(".5"), Some(0.5));
    assert_eq!(parse_number("1.7976931348623157e308"), Some(f64::MAX));

    // A BigInt is a different type with different arithmetic, and is not
    // this. Saying so beats parsing off the `n` and being quietly wrong.
    assert_eq!(parse_number("1n"), None);
}

/// The reason this function exists rather than trusting the checker.
///
/// The pre-switch tsgo returned `1` for this literal: a mantissa of sixteen nines is above
/// 2^53 and rounds up before the division by a power of ten. The neighbour
/// below survives, because that mantissa is even. Rust's parser is correctly
/// rounded and the literal's own text is the authority on what it says.
#[test]
fn seventeen_significant_digits_survive() {
    assert_eq!(
        parse_number("0.9999999999999999"),
        Some(0.999_999_999_999_999_9)
    );
    assert_ne!(parse_number("0.9999999999999999"), Some(1.0));
    assert_eq!(
        parse_number("0.9999999999999998"),
        Some(0.999_999_999_999_999_8)
    );
    assert_eq!(
        parse_number("1.9999999999999998"),
        Some(1.999_999_999_999_999_8)
    );
}
