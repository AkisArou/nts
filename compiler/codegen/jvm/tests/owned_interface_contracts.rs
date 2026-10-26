//! Read actual owned contracts before proposing a JVM interface repair.
//! Runtime, isolated control and subject take three distinct normal snapshots.
//! The isolated control completes before the subject is captured.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{Callee, Func, HirType, ManagedType, OpKind, Program};
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{
    NodeData, NodeId, NodeKind, NodeRecord, PropertyKey, SemanticSnapshot, TypeKind, children,
    syntax,
};

mod common;

fn child<'a>(
    snapshot: &'a SemanticSnapshot,
    node: &NodeRecord,
    role: &str,
) -> Option<&'a NodeRecord> {
    let NodeKind::Syntax(kind) = node.kind else {
        return None;
    };
    let NodeData::Children { present, .. } = node.data else {
        return None;
    };
    let slot = children::properties(kind)
        .iter()
        .position(|name| *name == role)?;
    let bit = 1_u8 << slot;
    if present & bit == 0 {
        return None;
    }
    let index = (present & (bit - 1)).count_ones() as usize;
    snapshot.nodes.get(node.children.get(index)?.0 as usize)
}

fn print_owned_declarations(snapshot: &SemanticSnapshot, member: &str) {
    for (at, node) in snapshot.nodes.iter().enumerate().filter(|(_, node)| {
        matches!(node.kind, NodeKind::Syntax(kind)
            if kind == syntax::METHOD_DECLARATION || kind == syntax::METHOD_SIGNATURE)
    }) {
        if child(snapshot, node, "name")
            .and_then(|name| name.text.as_ref())
            .and_then(|text| text.as_utf8())
            != Some(member)
        {
            continue;
        }
        let id = NodeId(u32::try_from(at).unwrap());
        println!(
            "owned declaration {id:?}: {node:?}; node type: {:?}",
            snapshot.node_types.get(&id)
        );
        if let Some(params) = child(snapshot, node, "parameters") {
            for id in &params.children {
                let param = &snapshot.nodes[id.0 as usize];
                println!(
                    "  parameter {id:?}: {param:?}; optional-token={:?}; initializer={:?}",
                    child(snapshot, param, "questionToken"),
                    child(snapshot, param, "initializer")
                );
            }
        }
    }
}

fn implementation_declaration(
    snapshot: &SemanticSnapshot,
    implementation: &Func,
    member: &str,
) -> NodeId {
    let HirType::Managed(ManagedType::Object(receiver)) = &implementation.params[0].ty else {
        panic!("actual method receiver is not an object")
    };
    let TypeKind::Object { properties } = &snapshot
        .types
        .get(receiver.0 as usize)
        .expect("actual receiver must link into this owned snapshot; otherwise discovery only")
        .kind
    else {
        panic!("actual receiver has no complete owned object")
    };
    let mut properties = properties
        .iter()
        .filter(|property| property.name == PropertyKey::Name(member.into()));
    let property = properties.next().expect("member on actual receiver");
    assert!(
        properties.next().is_none(),
        "ambiguous owned receiver property"
    );
    let declaration = property.declaration.expect("owned property declaration");
    let node = &snapshot.nodes[declaration.0 as usize];
    let symbol = node
        .symbol
        .or_else(|| child(snapshot, node, "name").and_then(|name| name.symbol))
        .expect("the exact member declaration's symbol");
    let declarations = &snapshot.symbols[symbol.0 as usize].declarations;
    let mut candidates: Vec<_> = declarations
        .iter()
        .copied()
        .chain(std::iter::once(declaration))
        .filter(|id| {
            let node = &snapshot.nodes[id.0 as usize];
            node.kind == NodeKind::Syntax(syntax::METHOD_DECLARATION)
                && child(snapshot, node, "body").is_some()
                && node.origin.location == implementation.origin.location
        })
        .collect();
    candidates.sort_by_key(|id| id.0);
    candidates.dedup();
    assert_eq!(
        candidates.len(),
        1,
        "missing/ambiguous exact receiver {receiver:?} property {property:?} declaration {declaration:?} symbol {symbol:?} body origin {:?}: {candidates:?}",
        implementation.origin
    );
    println!(
        "BOUND receiver={receiver:?}; property={property:?}; property_node={declaration:?}; symbol={symbol:?}; symbol_declarations={declarations:?}; body_node={:?}; body_origin={:?}",
        candidates[0], implementation.origin
    );
    candidates[0]
}

fn assert_written_optional_tail(snapshot: &SemanticSnapshot, implementation: &Func, member: &str) {
    let id = implementation_declaration(snapshot, implementation, member);
    let node = &snapshot.nodes[id.0 as usize];
    let params = child(snapshot, node, "parameters").expect("exact implementation parameters");
    assert_eq!(
        params.children.len() + 1,
        implementation.params.len(),
        "actual receiver + written parameters"
    );
    let tail = *params.children.last().expect("written optional tail");
    let param = &snapshot.nodes[tail.0 as usize];
    assert_eq!(
        child(snapshot, param, "name")
            .and_then(|name| name.text.as_ref())
            .and_then(|text| text.as_utf8()),
        Some("listener"),
        "exact last implementation parameter"
    );
    assert!(
        child(snapshot, param, "questionToken").is_some(),
        "actual bound optional tail is not optional: {param:?}"
    );
    assert!(
        child(snapshot, param, "initializer").is_none(),
        "actual bound tail unexpectedly has a default: {param:?}"
    );
    assert!(
        child(snapshot, param, "dotDotDotToken").is_none(),
        "actual tail is not a rest parameter"
    );
    println!("BOUND optional parameter {tail:?} on body {id:?}: {param:?}");
}

fn print_owned_properties(snapshot: &SemanticSnapshot, owners: &[&str], member: &str) {
    for (at, record) in snapshot.types.iter().enumerate() {
        let Some(symbol) = record
            .symbol
            .and_then(|id| snapshot.symbols.get(id.0 as usize))
        else {
            continue;
        };
        if !owners
            .iter()
            .any(|owner| symbol.name == PropertyKey::Name((*owner).into()))
        {
            continue;
        }
        let TypeKind::Object { properties } = &record.kind else {
            continue;
        };
        for property in properties
            .iter()
            .filter(|property| property.name == PropertyKey::Name(member.into()))
        {
            println!("owned type {at} {:?}: {property:?}", symbol.name);
            if let TypeKind::Function(id) = &snapshot.types[property.ty.0 as usize].kind {
                println!(
                    "  signature {id:?}: {:?}",
                    snapshot.signatures[id.0 as usize]
                );
            }
        }
    }
}

fn body<'a>(program: &'a Program, name: &str) -> &'a Func {
    let mut bodies = program.funcs.iter().filter(|func| func.name == name);
    let found = bodies
        .next()
        .unwrap_or_else(|| panic!("actual retained body {name} missing"));
    assert!(bodies.next().is_none(), "duplicate body {name}");
    println!("actual body {name}: {found:#?}");
    found
}

fn print_tables(program: &Program, owners: &[&str], members: &[&str]) {
    for layout in program
        .layouts
        .iter()
        .filter(|layout| owners.contains(&layout.name.as_str()))
    {
        println!(
            "actual layout {} types={:?} base={:?} interfaces={:?}",
            layout.name, layout.types, layout.base, layout.interfaces
        );
        for (slot, entry) in layout.methods.iter().enumerate() {
            if entry
                .as_ref()
                .is_some_and(|name| members.iter().any(|member| name.contains(member)))
            {
                println!(
                    "  slot {slot}: {entry:?}; raising={:?}",
                    program.raising_members.get(&u32::try_from(slot).unwrap())
                );
            }
        }
    }
}

fn preserve(program: &Program, name: &str) {
    let path = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("owned-interface-{name}-{}.txt", std::process::id()));
    std::fs::write(&path, format!("{program:#?}")).unwrap();
    println!("complete prepared Program: {}", path.display());
}

fn preserve_emission(emitted: &nts_codegen_jvm::Emitted, name: &str) {
    let root = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("owned-interface-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("diagnostics.txt"),
        format!("{:#?}", emitted.diagnostics),
    )
    .unwrap();
    for class in &emitted.classes {
        let path = root.join("classes").join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, &class.bytes).unwrap();
    }
    println!(
        "actual {name} emitted classes/diagnostics: {}",
        root.display()
    );
}

#[test]
fn real_stream_retains_its_owned_identity_and_parameter_authorities() {
    let config = Utf8Path::from_path(&common::repository())
        .unwrap()
        .join("runtime/node/stream/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("one normal stream snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    print_owned_declarations(&snapshot, "listenerCount");
    print_owned_properties(
        &snapshot,
        &["EventEmitter", "DestroyableStream"],
        "listenerCount",
    );
    let prepared = common::prepare(&snapshot).expect("the actual JVM host-GC preparation");
    let program = &prepared.program;
    preserve(program, "stream");
    print_tables(
        program,
        &[
            "EventEmitter",
            "Stream",
            "Readable",
            "Writable",
            "Duplex",
            "DestroyableStream",
        ],
        &["listenerCount", "_destroy"],
    );
    println!(
        "all actual identity_projections: {:#?}",
        program.identity_projections
    );
    for owner in ["Readable", "Writable"] {
        let target = format!("{owner}#_destroy");
        let adapter = format!("{target}@DestroyableStream");
        let direct = body(program, &target);
        let projected = body(program, &adapter);
        assert_eq!(
            program.identity_projections.get(&adapter),
            Some(&target),
            "real owned map membership must be observed, never inferred from bytecode"
        );
        assert_eq!(direct.params.len(), projected.params.len());
        assert_eq!(direct.return_type, projected.return_type);
    }
    let implementation = body(program, "EventEmitter#listenerCount");
    assert_written_optional_tail(&snapshot, implementation, "listenerCount");
    let declaration = body(program, "DestroyableStream#listenerCount");
    assert_eq!(
        implementation.params.len(),
        3,
        "receiver + event + optional listener"
    );
    assert_eq!(declaration.params.len(), 2, "receiver + event");
}

fn retained_parent_state(program: &Program) -> (&Func, &nts_core::hir::Layout) {
    let implementation = body(program, "Parent#count");
    let HirType::Managed(ManagedType::Object(receiver)) = &implementation.params[0].ty else {
        panic!("NONREPRO: Parent count lost its object receiver")
    };
    let receiver = *receiver;
    let parent = program
        .layouts
        .iter()
        .find(|layout| layout.types.contains(&receiver))
        .expect("NONREPRO: Parent receiver layout missing");
    let field = parent
        .fields
        .iter()
        .position(|field| field.name.is_name("bias"))
        .expect("NONREPRO: Parent state was removed");
    assert_eq!(
        parent.fields[field].ty,
        HirType::NUMBER,
        "actual retained numeric state"
    );
    assert_eq!(
        parent.fields[field].declared_by,
        Some(receiver),
        "actual declaring receiver"
    );
    let reads: Vec<_> = implementation
        .blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter(|id| {
            matches!(&implementation.values[id.0 as usize].kind,
            OpKind::FieldGet { object, field: at } if *at as usize == field
                && matches!(implementation.values[object.0 as usize].kind, OpKind::Param(0)))
        })
        .collect();
    assert!(
        !reads.is_empty(),
        "NONREPRO: no actual Parent state read from the unknown receiver parameter"
    );
    println!(
        "RETAINED bias field {field} on {receiver:?}, active reads {reads:?}, layout {parent:?}"
    );
    (implementation, parent)
}

fn assert_separate_counter_domain(program: &Program) {
    let (_, parent) = retained_parent_state(program);
    let identity = program
        .interface_identities
        .iter()
        .find(|identity| identity.name == "Counter")
        .expect("NONREPRO: Counter's owned interface identity is missing");
    let layouts: Vec<_> = program
        .layouts
        .iter()
        .filter(|layout| layout.types.iter().any(|ty| identity.types.contains(ty)))
        .collect();
    assert_eq!(
        layouts.len(),
        1,
        "NONREPRO: missing/ambiguous Counter layout: {identity:?}"
    );
    assert!(
        !std::ptr::eq(parent, layouts[0]),
        "NONREPRO: Counter still merged with Parent's state"
    );
    assert!(
        layouts[0].fields.is_empty(),
        "exact method-only interface contract"
    );
    println!(
        "SEPARATE Counter identity {identity:?}, layout {:?}",
        layouts[0]
    );
}

fn assert_control_call(snapshot: &SemanticSnapshot, program: &Program) {
    let (implementation, _) = retained_parent_state(program);
    assert_written_optional_tail(snapshot, implementation, "count");
    let caller = body(program, "throughContract");
    let sites: Vec<_> = caller
        .blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter_map(|id| match &caller.values[id.0 as usize].kind {
            OpKind::Call {
                callee: Callee::Direct(target),
                args,
                ..
            } if target == &implementation.name => Some(args),
            _ => None,
        })
        .collect();
    assert_eq!(
        sites.len(),
        1,
        "NONREPRO: isolated control lacks the actual direct class call"
    );
    assert_eq!(sites[0].len(), 3, "actual receiver/event/padded listener");
    assert!(
        matches!(
            caller.values[sites[0][2].0 as usize].kind,
            OpKind::ConstUndefined
        ),
        "NONREPRO: control's actual missing tail is not an owned undefined constant"
    );
}

fn assert_control_classes(emitted: &nts_codegen_jvm::Emitted) {
    for name in ["Parent", "Child"] {
        assert!(
            emitted
                .classes
                .iter()
                .any(|class| class.binary_name == format!("nts/gen/{name}")),
            "NONREPRO: isolated control {name} class missing: {:?}",
            emitted.diagnostics
        );
    }
    let class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Program")
        .expect("NONREPRO: isolated control Program missing");
    let class = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
    assert!(
        class
            .methods
            .iter()
            .any(|method| method.name == "throughContract"
                && method
                    .code
                    .as_ref()
                    .is_some_and(|code| !code.bytes.is_empty())),
        "NONREPRO: actual isolated control class-call method absent/empty"
    );
    assert!(
        emitted.diagnostics.is_empty(),
        "NONREPRO: isolated control backend refusal: {:?}",
        emitted.diagnostics
    );
}

fn assert_isolated_class_control() {
    let config = Utf8Path::from_path(&common::repository()).unwrap().join(
        "tests/programs/an-inherited-optional-tail-keeps-its-interface-contract-control/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("one isolated class-control snapshot");
    assert!(
        !snapshot.has_errors(),
        "NONREPRO: control source diagnostics: {:?}",
        snapshot.diagnostics
    );
    let prepared = common::prepare(&snapshot).expect("NONREPRO: control preparation failed");
    let program = &prepared.program;
    preserve(program, "isolated-control");
    assert_control_call(&snapshot, program);
    let emitted = nts_codegen_jvm::emit(program);
    preserve_emission(&emitted, "isolated-control");
    println!("isolated control emission: {:#?}", emitted.diagnostics);
    assert_control_classes(&emitted);
}

#[test]
fn an_inherited_optional_tail_keeps_the_one_argument_interface_contract() {
    // This separate capture drops all control facts/classes before subject capture.
    assert_isolated_class_control();
    let config = Utf8Path::from_path(&common::repository()).unwrap().join(
        "tests/programs/an-inherited-optional-tail-keeps-its-interface-contract/tsconfig.json",
    );
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("one normal reduction snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    print_owned_declarations(&snapshot, "count");
    print_owned_properties(&snapshot, &["Parent", "Child", "Counter"], "count");
    let prepared = common::prepare(&snapshot).expect("valid actual JVM host-GC prepared HIR");
    let program = &prepared.program;
    preserve(program, "optional-tail");
    print_tables(program, &["Parent", "Child", "Counter"], &["count"]);
    assert_separate_counter_domain(program);
    for name in ["subject", "control", "throughContract", "throughClass"] {
        assert!(
            body(program, name).exported,
            "original source export {name} lost"
        );
    }
    let implementation = body(program, "Parent#count");
    assert_written_optional_tail(&snapshot, implementation, "count");
    assert_eq!(implementation.params.len(), 3);
    assert_eq!(body(program, "Counter#count").params.len(), 2);
    let caller = body(program, "throughContract");
    let sites: Vec<_> = caller
        .blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter_map(|id| match &caller.values[id.0 as usize].kind {
            OpKind::Call {
                callee: Callee::Virtual { slot, declared },
                args,
                ..
            } if declared == "Counter#count" => Some((*slot, args)),
            _ => None,
        })
        .collect();
    assert_eq!(
        sites.len(),
        1,
        "the intended actual face call was optimized/refused away"
    );
    assert_eq!(sites[0].1.len(), 2, "receiver + event at the actual call");
    let emitted = nts_codegen_jvm::emit(program);
    preserve_emission(&emitted, "subject");
    println!("actual reduced emission: {:#?}", emitted.diagnostics);
    assert!(
        emitted
            .classes
            .iter()
            .any(|class| class.binary_name == "nts/gen/Program"),
        "the shared scalar bodies did not emit: {:?}",
        emitted.diagnostics
    );
    assert!(
        emitted
            .classes
            .iter()
            .any(|class| class.binary_name == "nts/gen/Child"),
        "the subject receiver must remain emit-able under its face contract: {:?}",
        emitted.diagnostics
    );
}
