//! Owned-HIR controls for a face merged with another face's materialized rows.
//! These add no frontend capture or Java process.

use nts_codegen_jvm::{JvmProgram, body, types, widen};
use nts_core::hir::{
    Absent, Block, ClassIdentity, Field, Func, HirType, InterfaceIdentity, Layout, ManagedType, Op,
    OpKind, Param, ParamShape, Program, Terminator, ValueId, facts::Facts, interface_access,
};
use nts_diagnostics::{Diagnostic, Location, SourceId, Span};
use nts_jvm_emitter::{Body, Pool, VType, read};
use nts_semantic_schema::{Origin, PropertyKey, TypeId};

const SOURCE: TypeId = TypeId(0);
const OPAQUE: TypeId = TypeId(1);
const FAMILY: TypeId = TypeId(2);
const NOMINAL: TypeId = TypeId(3);
const SPECIALIZED: TypeId = TypeId(4);
const HOLDER: TypeId = TypeId(5);

fn object(id: TypeId) -> HirType {
    HirType::Managed(ManagedType::Object(id))
}

fn function(name: &str, params: &[HirType], returned: HirType, value: Option<ValueId>) -> Func {
    let origin = Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    });
    let params: Vec<_> = params
        .iter()
        .enumerate()
        .map(|(at, ty)| Param {
            name: format!("p{at}"),
            ty: ty.clone(),
            origin: origin.clone(),
            written: None,
            shape: ParamShape::Ordinary,
            known: Facts::TOP,
        })
        .collect();
    let values: Vec<_> = params
        .iter()
        .enumerate()
        .map(|(at, param)| Op {
            kind: OpKind::Param(u32::try_from(at).unwrap()),
            ty: param.ty.clone(),
            origin: origin.clone(),
        })
        .collect();
    Func {
        name: name.into(),
        params,
        return_type: returned,
        written_return: None,
        written_return_elements: Vec::new(),
        result_absent: Absent::Impossible,
        blocks: vec![Block {
            params: Vec::new(),
            ops: (0..values.len())
                .map(|at| ValueId(u32::try_from(at).unwrap()))
                .collect(),
            terminator: Terminator::Return(value),
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

fn push(func: &mut Func, kind: OpKind, ty: HirType) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap());
    func.values.push(Op {
        kind,
        ty,
        origin: func.origin.clone(),
    });
    func.blocks[0].ops.push(id);
    id
}

fn getter() -> Func {
    let mut func = function(
        "Other#get n@Merged",
        &[object(NOMINAL)],
        HirType::Erased,
        None,
    );
    let value = push(&mut func, OpKind::ConstUndefined, HirType::Erased);
    func.blocks[0].terminator = Terminator::Return(Some(value));
    func.exported = false;
    func.result_absent = Absent::Undefined;
    func
}

fn store() -> Func {
    let mut func = function(
        "store",
        &[object(HOLDER), object(SOURCE)],
        HirType::Void,
        None,
    );
    push(
        &mut func,
        OpKind::FieldSet {
            object: ValueId(0),
            field: 0,
            value: ValueId(1),
        },
        HirType::Void,
    );
    func
}

fn field(name: &str, ty: HirType) -> Field {
    Field {
        name: PropertyKey::Name(name.into()),
        ty,
        written: None,
        declared_by: None,
        readonly: false,
    }
}

fn layout(name: &str, types: Vec<TypeId>, fields: Vec<Field>) -> Layout {
    Layout {
        name: name.into(),
        types,
        fields,
        methods: Vec::new(),
        interfaces: Vec::new(),
        base: None,
    }
}

fn interface(name: &str, types: Vec<TypeId>) -> InterfaceIdentity {
    InterfaceIdentity {
        symbol: types[0].0,
        name: name.into(),
        parents: types.iter().map(|id| (*id, Vec::new())).collect(),
        names: std::collections::BTreeMap::default(),
        types,
    }
}

fn declared() -> Func {
    let mut func = function("Other#get n", &[object(FAMILY)], HirType::Erased, None);
    func.abstract_declaration = true;
    func.exported = false;
    func
}

fn access_plan() -> interface_access::Plan {
    let mut plan = interface_access::Plan::default();
    plan.families.push(interface_access::Family {
        face: FAMILY,
        member: PropertyKey::Name("n".into()),
        field: Some(0),
        getter: interface_access::Entry {
            slot: 0,
            declared: "Other#get n".into(),
        },
        setter: None,
        raising: Vec::new(),
        owners: Vec::new(),
        eager: false,
        pending: false,
        stored_dispatch: true,
    });
    plan.default_bodies
        .insert("Other#get n@Merged".into(), false);
    plan.materialized = true;
    plan
}

fn fixture() -> Program {
    let mut merged = layout("Merged", vec![OPAQUE, NOMINAL, SPECIALIZED], Vec::new());
    merged.methods.push(Some("Other#get n@Merged".into()));
    Program {
        funcs: vec![
            declared(),
            getter(),
            function(
                "returned",
                &[object(SOURCE)],
                object(OPAQUE),
                Some(ValueId(0)),
            ),
            function(
                "received",
                &[object(OPAQUE)],
                object(OPAQUE),
                Some(ValueId(0)),
            ),
            store(),
        ],
        layouts: vec![
            layout(
                "Source",
                vec![SOURCE],
                vec![field("state", HirType::NUMBER)],
            ),
            merged,
            layout("Holder", vec![HOLDER], vec![field("value", object(OPAQUE))]),
            layout("Other", vec![FAMILY], vec![field("n", HirType::Erased)]),
        ],
        classes: vec![ClassIdentity {
            symbol: 3,
            name: "Nominal".into(),
            types: vec![NOMINAL],
        }],
        interface_identities: vec![
            interface("Opaque", vec![OPAQUE, SPECIALIZED]),
            interface("Other", vec![FAMILY]),
        ],
        interface_access: access_plan(),
        ..Program::default()
    }
}

fn rendered(program: &Program, name: &str) -> Result<Body, Diagnostic> {
    let facts = JvmProgram::new(program);
    let func = program.funcs.iter().find(|func| func.name == name).unwrap();
    let plan = widen::plan(types::DEFAULT_PACKAGE, &facts);
    let emitter = body::Emitter::new(types::DEFAULT_PACKAGE, &facts, func, &plan, false)?;
    emitter
        .emit(&mut Pool::default())
        .map_err(|error| error.diagnostic)
}

fn retain_owned(program: &Program, emitted: &nts_codegen_jvm::Emitted) {
    if std::env::var("NTS_KEEP_TEST_SCRATCH").as_deref() != Ok("1") {
        return;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../../target/tmp/opaque-default-{}-{stamp}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("program.txt"), format!("{program:#?}")).unwrap();
    std::fs::write(
        dir.join("diagnostics.txt"),
        format!("{:#?}", emitted.diagnostics),
    )
    .unwrap();
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, &class.bytes).unwrap();
    }
    eprintln!("OPAQUE_DEFAULT_ARTIFACTS {}", dir.display());
}

fn assert_not_root(program: &Program, id: TypeId, label: &str) {
    assert!(!types::root_typed(&JvmProgram::new(program), id), "{label}");
}

#[test]
fn other_faces_rows_do_not_change_each_opaque_specializations_reference() {
    let program = fixture();
    let facts = JvmProgram::new(&program);
    assert_eq!(facts.selector(0), Some("Other#get n"));
    assert_eq!(program.layouts[1].methods.len(), 1);
    for id in [OPAQUE, SPECIALIZED] {
        assert!(types::root_typed(&facts, id), "{id:?}");
        assert_eq!(
            types::descriptor(types::Shape::of(&facts), &object(id)).as_deref(),
            Some("Ljava/lang/Object;")
        );
        assert_eq!(
            types::vtype(types::Shape::of(&facts), &object(id)),
            Some(VType::Object(types::OBJECT.into()))
        );
    }
    assert!(
        !types::root_typed(&facts, FAMILY),
        "own family must keep its reference"
    );
    assert!(
        !types::root_typed(&facts, NOMINAL),
        "co-located nominal class must keep its reference"
    );
    assert_ne!(
        types::object_reference(types::DEFAULT_PACKAGE, &facts, NOMINAL),
        types::OBJECT
    );
}

#[test]
fn cached_selectors_keep_each_family_when_one_default_body_is_shared() {
    let mut program = fixture();
    let mut other = program.interface_access.families[0].clone();
    other.face = SOURCE;
    other.getter.slot = 1;
    other.getter.declared = "Source#get other".into();
    program.interface_access.families.push(other);
    program.layouts[1]
        .methods
        .push(Some("Other#get n@Merged".into()));
    let facts = JvmProgram::new(&program);
    assert_eq!(facts.selector(0), Some("Other#get n"));
    assert_eq!(facts.selector(1), Some("Source#get other"));
    assert!(types::root_typed(&facts, OPAQUE));
    assert!(types::root_typed(&facts, SPECIALIZED));
    assert!(!types::root_typed(&facts, NOMINAL));
}

#[test]
fn unknown_ordinary_and_outside_layout_slots_keep_the_conservative_boundary() {
    let base = fixture();
    let mut unknown = base.clone();
    unknown.interface_access.families.clear();
    assert_not_root(&unknown, OPAQUE, "missing selector authority");
    let mut unpublished = base.clone();
    unpublished.interface_access.default_bodies.clear();
    assert_not_root(&unpublished, OPAQUE, "no published missing-field default");
    let mut ordinary = base.clone();
    ordinary.layouts[1].methods.push(Some("ordinary".into()));
    assert_not_root(&ordinary, OPAQUE, "ordinary populated slot");
    let mut outside = base.clone();
    let row = outside
        .funcs
        .iter_mut()
        .find(|func| func.name == "Other#get n@Merged")
        .unwrap();
    row.params[0].ty = object(SOURCE);
    row.values[0].ty = object(SOURCE);
    assert_not_root(
        &outside,
        OPAQUE,
        "actual row receiver outside merged layout",
    );
    let mut missing_owner = base.clone();
    missing_owner.interface_access.families[0].face = TypeId(999);
    assert_not_root(&missing_owner, OPAQUE, "unknown selector owner");
    let mut missing_body = base.clone();
    missing_body.layouts[1].methods[0] = Some("gone".into());
    assert_not_root(&missing_body, OPAQUE, "missing row body");
    let mut own_receiver = base.clone();
    let row = own_receiver
        .funcs
        .iter_mut()
        .find(|func| func.name == "Other#get n@Merged")
        .unwrap();
    row.params[0].ty = object(OPAQUE);
    row.values[0].ty = object(OPAQUE);
    assert_not_root(&own_receiver, OPAQUE, "row receiver is this target type");

    let mut wrong_receiver_kind = base.clone();
    let row = wrong_receiver_kind
        .funcs
        .iter_mut()
        .find(|func| func.name == "Other#get n@Merged")
        .unwrap();
    row.params[0].ty = HirType::Erased;
    row.values[0].ty = HirType::Erased;
    assert_not_root(&wrong_receiver_kind, OPAQUE, "no owned object receiver");
    let mut own = base;
    own.interface_access.families[0].face = OPAQUE;
    assert_not_root(&own, OPAQUE, "own populated family");
    assert!(
        types::root_typed(&JvmProgram::new(&own), SPECIALIZED),
        "another specialization remains independent"
    );
}

#[test]
fn identity_state_subclass_and_foreign_boundaries_do_not_become_opaque() {
    let base = fixture();
    let mut identity = base.clone();
    identity.interface_identities.clear();
    assert_not_root(&identity, OPAQUE, "no semantic interface identity");
    let mut nominal = base.clone();
    nominal.classes[0].types.push(OPAQUE);
    assert_not_root(
        &nominal,
        OPAQUE,
        "nominal identity on target specialization",
    );
    let mut state = base.clone();
    state.layouts[1]
        .fields
        .push(field("state", HirType::NUMBER));
    assert_not_root(&state, OPAQUE, "physical field state");
    let mut subclass = base.clone();
    let mut child = layout("Extender", vec![TypeId(10)], Vec::new());
    child.base = Some(OPAQUE);
    subclass.layouts.push(child);
    assert_not_root(&subclass, OPAQUE, "a layout extends the shared layout");
    let mut foreign = base;
    foreign.layouts[1].name = "provided/Face".into();
    assert_not_root(&foreign, OPAQUE, "foreign binary owner");
    let mut foreign_selector = fixture();
    foreign_selector.layouts[3].name = "provided/Other".into();
    assert_not_root(&foreign_selector, OPAQUE, "foreign source selector face");
    let mut shadowed = fixture();
    shadowed
        .layouts
        .insert(0, layout("provided/Earlier", vec![FAMILY], Vec::new()));
    assert_not_root(
        &shadowed,
        OPAQUE,
        "first layout resolution is foreign even with later local duplicate",
    );
}

#[test]
fn actual_return_field_store_and_frame_share_the_object_reference() {
    let program = fixture();
    for name in ["returned", "received", "store"] {
        let body = rendered(&program, name).unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert!(!body.code.is_empty(), "{name} emitted no code");
        if name == "received" {
            assert_eq!(body.locals[0], VType::Object(types::OBJECT.into()));
        }
    }
    let emitted = nts_codegen_jvm::emit(&program);
    retain_owned(&program, &emitted);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    let classes: Vec<_> = emitted
        .classes
        .iter()
        .map(|class| read::class_file(&class.bytes).unwrap())
        .collect();
    let program_class = classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Program")
        .unwrap();
    for (name, descriptor) in [
        ("returned", "(Lnts/gen/Source;)Ljava/lang/Object;"),
        ("received", "(Ljava/lang/Object;)Ljava/lang/Object;"),
        ("store", "(Lnts/gen/Holder;Lnts/gen/Source;)V"),
    ] {
        let method = program_class
            .methods
            .iter()
            .find(|method| method.name == name)
            .unwrap();
        assert_eq!(method.descriptor, descriptor, "{name}");
        assert!(
            method
                .code
                .as_ref()
                .is_some_and(|code| !code.bytes.is_empty()),
            "{name}"
        );
    }
    let holder = classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Holder")
        .unwrap();
    assert_eq!(holder.fields[0].descriptor, "Ljava/lang/Object;");
}

#[test]
fn a_value_of_the_opaque_face_cannot_escape_into_the_merged_class() {
    let mut program = fixture();
    program.funcs.push(function(
        "escape",
        &[object(OPAQUE)],
        object(NOMINAL),
        Some(ValueId(0)),
    ));
    let error = rendered(&program, "escape").expect_err("root-to-class must refuse");
    assert_eq!(error.code, "NTS4001");
    assert!(
        error
            .message
            .contains("a face that promises nothing is held as java/lang/Object here"),
        "{}",
        error.message
    );
}
