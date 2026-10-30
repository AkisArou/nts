//! A captured reachable contract must not retain an unrequested type slot.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::BTreeSet;
use std::fmt::Write as _;

use camino::Utf8Path;
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{PropertyKey, SemanticSnapshot, SignatureId, TypeId, TypeKind};

fn signature_types(snapshot: &SemanticSnapshot, id: SignatureId, work: &mut Vec<TypeId>) {
    let signature = &snapshot.signatures[id.0 as usize];
    work.extend(signature.parameters.iter().map(|parameter| parameter.ty));
    work.push(signature.return_type);
    work.extend(signature.type_parameters.iter().copied());
    work.extend(signature.this_type);
    work.extend(
        signature
            .type_predicate
            .as_ref()
            .and_then(|predicate| predicate.narrowed_to),
    );
}

fn unrequested(snapshot: &SemanticSnapshot) -> Vec<TypeId> {
    let reached = nts_semantic_schema::reachability::for_frontend(snapshot);
    let mut work = reached.seeds();
    let mut seen = BTreeSet::new();
    let mut missing = Vec::new();
    while let Some(id) = work.pop() {
        if !seen.insert(id) {
            continue;
        }
        let record = &snapshot.types[id.0 as usize];
        match &record.kind {
            TypeKind::Unsupported { rendered } => {
                if rendered == "a native type whose graph has not been requested" {
                    missing.push(id);
                }
            }
            TypeKind::Object { properties } => {
                for property in properties {
                    work.push(property.ty);
                    if let PropertyKey::Symbol(key) = property.name {
                        work.push(key);
                    }
                }
            }
            TypeKind::Array(element) => work.push(*element),
            TypeKind::Tuple(tuple) => work.extend(tuple.elements.iter().copied()),
            TypeKind::Union(parts) | TypeKind::Intersection(parts) => {
                work.extend(parts.iter().copied());
            }
            TypeKind::Function(signature) => signature_types(snapshot, *signature, &mut work),
            TypeKind::TypeParameter { constraint, .. } => work.extend(*constraint),
            TypeKind::Conditional {
                check,
                extends,
                true_type,
                false_type,
            } => {
                work.extend([*check, *extends]);
                work.extend(*true_type);
                work.extend(*false_type);
            }
            TypeKind::IndexedAccess { object, index } => work.extend([*object, *index]),
            TypeKind::TemplateLiteral { types, .. } => work.extend(types.iter().copied()),
            TypeKind::Any
            | TypeKind::Evolving
            | TypeKind::Unknown
            | TypeKind::Never
            | TypeKind::Void
            | TypeKind::Undefined
            | TypeKind::Null
            | TypeKind::Boolean
            | TypeKind::Number
            | TypeKind::BigInt
            | TypeKind::String
            | TypeKind::Symbol
            | TypeKind::UniqueSymbol
            | TypeKind::NonPrimitive
            | TypeKind::Literal(_)
            | TypeKind::Structured => {}
        }
        work.extend(snapshot.base_types.get(&id).into_iter().flatten().copied());
        work.extend(
            snapshot
                .type_arguments
                .get(&id)
                .into_iter()
                .flatten()
                .copied(),
        );
        for index in snapshot.index_signatures.get(&id).into_iter().flatten() {
            work.extend([index.key, index.value]);
        }
        work.extend(snapshot.bound_types.get(&id).copied());
    }
    missing.sort();
    missing
}

fn incoming_signature_edges(snapshot: &SemanticSnapshot, target: TypeId) -> Vec<String> {
    let mut incoming = Vec::new();
    for (index, signature) in snapshot.signatures.iter().enumerate() {
        let mut edge = |id: TypeId, relation: String| {
            if id == target {
                incoming.push(format!("signature {index} -> {relation}"));
            }
        };
        for (index, parameter) in signature.parameters.iter().enumerate() {
            edge(
                parameter.ty,
                format!("parameter {index} {:?}", parameter.name),
            );
        }
        edge(signature.return_type, "return".into());
        for &id in &signature.type_parameters {
            edge(id, "type parameter".into());
        }
        if let Some(id) = signature.this_type {
            edge(id, "this".into());
        }
        if let Some(id) = signature
            .type_predicate
            .as_ref()
            .and_then(|predicate| predicate.narrowed_to)
        {
            edge(id, "predicate".into());
        }
    }
    incoming
}

fn incoming_edges(snapshot: &SemanticSnapshot, target: TypeId) -> Vec<String> {
    let mut incoming = Vec::new();
    for (index, record) in snapshot.types.iter().enumerate() {
        let name = record
            .symbol
            .and_then(|id| snapshot.symbols[id.0 as usize].name.public_name())
            .unwrap_or("anonymous");
        let owner = format!("type {index} ({name})");
        let mut edge = |id: TypeId, relation: String| {
            if id == target {
                incoming.push(format!("{owner} -> {relation}"));
            }
        };
        match &record.kind {
            TypeKind::Object { properties } => {
                for property in properties {
                    edge(property.ty, format!("property {:?}", property.name));
                    if let PropertyKey::Symbol(id) = property.name {
                        edge(id, "property key".into());
                    }
                }
            }
            TypeKind::Array(id) => edge(*id, "array element".into()),
            TypeKind::Tuple(tuple) => {
                for (part, &id) in tuple.elements.iter().enumerate() {
                    edge(
                        id,
                        format!("tuple position {part} ({:?})", tuple.element_flags[part]),
                    );
                }
            }
            TypeKind::Union(parts) | TypeKind::Intersection(parts) => {
                for (part, &id) in parts.iter().enumerate() {
                    edge(id, format!("constituent {part}"));
                }
            }
            TypeKind::TypeParameter {
                constraint: Some(id),
                ..
            } => edge(*id, "constraint".into()),
            TypeKind::Conditional {
                check,
                extends,
                true_type,
                false_type,
            } => {
                edge(*check, "conditional check".into());
                edge(*extends, "conditional extends".into());
                if let Some(id) = true_type {
                    edge(*id, "conditional true".into());
                }
                if let Some(id) = false_type {
                    edge(*id, "conditional false".into());
                }
            }
            TypeKind::IndexedAccess { object, index } => {
                edge(*object, "indexed object".into());
                edge(*index, "indexed key".into());
            }
            TypeKind::TemplateLiteral { types, .. } => {
                for &id in types {
                    edge(id, "template part".into());
                }
            }
            _ => {}
        }
        let id = TypeId(u32::try_from(index).unwrap());
        for &base in snapshot.base_types.get(&id).into_iter().flatten() {
            edge(base, "base".into());
        }
        for (argument, &id) in snapshot
            .type_arguments
            .get(&id)
            .into_iter()
            .flatten()
            .enumerate()
        {
            edge(id, format!("type argument {argument}"));
        }
        for index in snapshot.index_signatures.get(&id).into_iter().flatten() {
            edge(index.key, "index key".into());
            edge(index.value, "index value".into());
        }
        if let Some(&id) = snapshot.bound_types.get(&id) {
            edge(id, "bound type".into());
        }
    }
    incoming.extend(incoming_signature_edges(snapshot, target));
    for (id, &ty) in &snapshot.node_types {
        if ty == target {
            let node = &snapshot.nodes[id.0 as usize];
            let location = node.origin.location;
            incoming.push(format!(
                "node {id:?} {:?} at {} {:?}",
                node.kind, snapshot.sources[location.file.0 as usize].display_path, location.span
            ));
        }
    }
    incoming
}

fn describe_missing(snapshot: &SemanticSnapshot) -> Vec<(TypeId, Vec<String>)> {
    unrequested(snapshot)
        .into_iter()
        .map(|id| (id, incoming_edges(snapshot, id)))
        .collect()
}

#[test]
fn collection_contracts_request_their_reachable_type_graphs() {
    let snapshot = capture("awfy-dictionary-hole-slots");
    assert!(
        unrequested(&snapshot).is_empty(),
        "{:#?}",
        describe_missing(&snapshot)
    );
    assert!(!snapshot.diagnostics.iter().any(|d| d.code == "NTS0003"));
    let mut vector_contracts = 0;
    for record in &snapshot.types {
        if !record
            .symbol
            .is_some_and(|id| snapshot.symbols[id.0 as usize].name.is_name("Vector"))
        {
            continue;
        }
        let TypeKind::Object { properties } = &record.kind else {
            continue;
        };
        vector_contracts += 1;
        for property in properties {
            if matches!(
                property.name.public_name(),
                Some(
                    "at" | "atPut"
                        | "append"
                        | "forEach"
                        | "hasSome"
                        | "getOne"
                        | "removeFirst"
                        | "remove"
                        | "swap"
                        | "sortRange"
                        | "sort"
                )
            ) {
                assert!(
                    matches!(
                        snapshot.types[property.ty.0 as usize].kind,
                        TypeKind::Function(_)
                    ),
                    "Vector member {:?} has no callable contract",
                    property.name
                );
            }
        }
    }
    assert!(
        vector_contracts > 0,
        "the fixture must reach a Vector contract"
    );
}

fn root() -> &'static Utf8Path {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
}

fn capture(name: &str) -> SemanticSnapshot {
    Frontend::new(root())
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(
            &root()
                .join("tests/programs")
                .join(name)
                .join("tsconfig.json"),
        )
        .unwrap()
}

#[test]
fn deep_builtin_bases_keep_reached_calls_and_source_owned_callbacks() {
    let deep = capture("a-deep-base-keeps-its-physical-storage");
    assert!(
        unrequested(&deep).is_empty(),
        "deep storage fixture retains unrequested types"
    );
    assert!(!deep.diagnostics.iter().any(|d| d.code == "NTS0003"));

    let directory =
        std::env::temp_dir().join(format!("nts-deep-native-members-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let mut text = String::from(
        "class Bytes0 extends Uint8Array { applyToFirst(callback: (value: number) => number): number { return callback(this[0]); } }\n",
    );
    for index in 1..=80 {
        writeln!(text, "class Bytes{index} extends Bytes{} {{}}", index - 1).unwrap();
    }
    text.push_str("export function inspect() { const bytes = new Bytes80([1, 2]); const mapped = bytes.map(value => value + 1); return bytes.applyToFirst(value => value + mapped[0]); }\n");
    std::fs::write(directory.join("main.ts"), text).unwrap();
    std::fs::write(directory.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"es2022","module":"esnext","types":[]},"files":["main.ts"]}"#).unwrap();
    let config = camino::Utf8PathBuf::from_path_buf(directory.join("tsconfig.json")).unwrap();
    let snapshot = Frontend::new(config.parent().unwrap())
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    std::fs::remove_dir_all(directory).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    assert!(!snapshot.diagnostics.iter().any(|d| d.code == "NTS0003"));
    assert!(
        unrequested(&snapshot).is_empty(),
        "reached inherited API leaves no placeholder"
    );
    for parameter in ["callbackfn", "callback"] {
        let contract = snapshot
            .call_targets
            .values()
            .find_map(|target| {
                let signature = &snapshot.signatures[target.signature.0 as usize];
                signature.parameters.first().filter(|p| p.name == parameter)
            })
            .unwrap_or_else(|| panic!("no reached {parameter} contract"));
        let TypeKind::Function(id) = snapshot.types[contract.ty.0 as usize].kind else {
            panic!("{parameter} must retain its concrete callable contract");
        };
        let signature = &snapshot.signatures[id.0 as usize];
        assert_eq!(
            snapshot.types[signature.parameters[0].ty.0 as usize].kind,
            TypeKind::Number
        );
        assert_eq!(
            snapshot.types[signature.return_type.0 as usize].kind,
            TypeKind::Number
        );
    }
}

#[test]
fn instantiated_callbacks_rest_and_composites_have_complete_reachable_contracts() {
    for name in [
        "a-closure-default-captures-its-parameter",
        "a-bound-function",
        "array-from-a-set-a-mapper-adds-to",
        "a-generic-pinned-only-through-a-callback",
        "a-fixed-arity-rest-is-positional",
        "a-generic-call-materializes-its-callers-composite-types",
        "a-generic-owner-returns-a-carried-iteration-contract",
    ] {
        let snapshot = capture(name);
        assert!(
            unrequested(&snapshot).is_empty(),
            "{name}: {:?}",
            unrequested(&snapshot)
        );
    }
}

fn protocol_snapshot(name: &str, text: &str) -> SemanticSnapshot {
    let directory =
        std::env::temp_dir().join(format!("nts-protocol-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("main.ts"), text).unwrap();
    std::fs::write(directory.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"es2022","module":"esnext","types":[]},"files":["main.ts"]}"#).unwrap();
    let config = camino::Utf8PathBuf::from_path_buf(directory.join("tsconfig.json")).unwrap();
    let snapshot = Frontend::new(config.parent().unwrap())
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    std::fs::remove_dir_all(directory).unwrap();
    assert!(!snapshot.has_errors(), "{name}: {:?}", snapshot.diagnostics);
    assert!(
        !snapshot.diagnostics.iter().any(|d| d.code == "NTS0003"),
        "{name}: budget"
    );
    assert!(unrequested(&snapshot).is_empty(), "{name}: unrequested");
    snapshot
}

fn contract(snapshot: &SemanticSnapshot, ty: TypeId) -> SignatureId {
    match &snapshot.types[ty.0 as usize].kind {
        TypeKind::Function(id) => *id,
        TypeKind::Union(parts) => parts
            .iter()
            .find_map(|ty| match snapshot.types[ty.0 as usize].kind {
                TypeKind::Function(id) => Some(id),
                _ => None,
            })
            .unwrap_or_else(|| panic!("no callable in {ty:?}")),
        kind => panic!("no callable contract for {ty:?}: {kind:?}"),
    }
}

#[test]
fn implicit_protocols_request_inherited_builtin_members() {
    use nts_semantic_schema::WellKnownSymbol;
    for (name, body) in [
        (
            "for-of",
            "export function inspect(input: Values) { let sum = 0; for (const value of input) sum += value; return sum; }",
        ),
        (
            "spread",
            "export function inspect(input: Values) { return [...input]; }",
        ),
        (
            "destructure",
            "export function inspect(input: Values) { const [first, ...rest] = input; return first! + rest.length; }",
        ),
        (
            "delegate",
            "export function* inspect(input: Values) { yield* input; }",
        ),
        (
            "array-from",
            "export function inspect(input: Values) { return Array.from(input); }",
        ),
        (
            "constraint",
            "export function inspect<T extends Values>(input: T) { let sum = 0; for (const value of input) sum += value; return sum; }",
        ),
        (
            "union",
            "export function inspect(input: Values | number[]) { let sum = 0; for (const value of input) sum += value; return sum; }",
        ),
    ] {
        let snapshot = protocol_snapshot(
            name,
            &format!("class Values extends Set<number> {{}}\n{body}"),
        );
        let properties = snapshot
            .types
            .iter()
            .find_map(|ty| {
                (ty.symbol
                    .is_some_and(|id| snapshot.symbols[id.0 as usize].name.is_name("Values")))
                .then_some(&ty.kind)
                .and_then(|kind| match kind {
                    TypeKind::Object { properties } => Some(properties),
                    _ => None,
                })
            })
            .unwrap();
        let method = properties
            .iter()
            .find(|p| snapshot.key_is_well_known(&p.name, WellKnownSymbol::Iterator))
            .unwrap();
        assert!(!method.own, "{name}: must use inherited iterator");
        let signature = contract(&snapshot, method.ty);
        let returned = snapshot.signatures[signature.0 as usize].return_type;
        // The factory contract is demanded, while its builtin return keeps
        // the representation boundary and element arguments it had before.
        assert_eq!(
            snapshot.types[returned.0 as usize].kind,
            TypeKind::Structured
        );
        assert!(
            snapshot.types[returned.0 as usize]
                .symbol
                .is_some_and(|id| snapshot.symbols[id.0 as usize].name.is_name("SetIterator")),
            "{name}: opaque iterator identity"
        );
        assert!(
            snapshot.type_arguments[&returned]
                .iter()
                .any(|id| snapshot.types[id.0 as usize].kind == TypeKind::Number),
            "{name}: iterator element"
        );
    }
    // The earlier boundary lost carried owners' inherited next/return even
    // where source methods themselves were all complete.
    let snapshot = capture("an-implicit-iterator-call-preserves-its-throw");
    for ty in &snapshot.types {
        if ty.symbol.is_some_and(|id| {
            snapshot.symbols[id.0 as usize]
                .name
                .is_name("IterableIterator")
        }) && let TypeKind::Object { properties } = &ty.kind
        {
            for member in ["next", "return"] {
                let property = properties.iter().find(|p| p.name.is_name(member)).unwrap();
                contract(&snapshot, property.ty);
            }
        }
    }
}

#[test]
fn implicit_coercion_requests_inherited_builtin_members() {
    for (name, body) in [
        ("template", "return `${input}`;"),
        ("plus", "return '' + input;"),
    ] {
        let snapshot = protocol_snapshot(
            name,
            &format!(
                "class Value extends Number {{}}\nexport function inspect(input: Value): string {{ {body} }}"
            ),
        );
        let properties = snapshot
            .types
            .iter()
            .find_map(|ty| {
                (ty.symbol
                    .is_some_and(|id| snapshot.symbols[id.0 as usize].name.is_name("Value")))
                .then_some(&ty.kind)
                .and_then(|kind| match kind {
                    TypeKind::Object { properties } => Some(properties),
                    _ => None,
                })
            })
            .unwrap();
        for member in ["toString", "valueOf"] {
            let property = properties.iter().find(|p| p.name.is_name(member)).unwrap();
            assert!(!property.own, "{name}: must use inherited {member}");
            contract(&snapshot, property.ty);
        }
    }
}

#[test]
fn carried_owners_keep_inherited_contracts_without_a_protocol_use() {
    let snapshot = protocol_snapshot(
        "carried",
        "export function retain<T>(input: IterableIterator<T>): IterableIterator<T> { return input; }",
    );
    let mut owners = 0;
    for ty in &snapshot.types {
        if ty.symbol.is_some_and(|id| {
            snapshot.symbols[id.0 as usize]
                .name
                .is_name("IterableIterator")
        }) {
            let TypeKind::Object { properties } = &ty.kind else {
                panic!("carried owner must be expanded");
            };
            owners += 1;
            for member in ["next", "return"] {
                let property = properties.iter().find(|p| p.name.is_name(member)).unwrap();
                assert!(!property.own, "carried {member} must be inherited");
                contract(&snapshot, property.ty);
            }
        }
    }
    assert!(owners > 0);
}

#[test]
fn coercion_demands_preserve_primitive_types() {
    let snapshot = protocol_snapshot(
        "primitive",
        "export function inspect(value: number, text: string): string { return text + (value + 1); }",
    );
    for (name, expected) in [("value", TypeKind::Number), ("text", TypeKind::String)] {
        let ty = snapshot
            .nodes
            .iter()
            .enumerate()
            .find_map(|(index, node)| {
                (node.text.as_ref().and_then(|text| text.as_utf8()) == Some(name))
                    .then(|| {
                        snapshot
                            .node_types
                            .get(&nts_semantic_schema::NodeId(u32::try_from(index).unwrap()))
                    })
                    .flatten()
            })
            .unwrap();
        assert_eq!(snapshot.types[ty.0 as usize].kind, expected);
    }
}

#[test]
fn protocol_demands_preserve_direct_builtin_storage() {
    let snapshot = protocol_snapshot(
        "typed-storage",
        "export function inspect(n: number) { const bytes = new Uint8Array(2); bytes[0] = n; return Array.from(bytes); }",
    );
    let mut found = false;
    for ty in &snapshot.types {
        if ty
            .symbol
            .is_some_and(|id| snapshot.symbols[id.0 as usize].name.is_name("Uint8Array"))
        {
            // A compiler-provided builtin is opaque even when source iterates
            // it. Opening it as an Object would replace typed-array storage.
            if matches!(ty.kind, TypeKind::Structured) {
                found = true;
            }
            assert!(!matches!(ty.kind, TypeKind::Object { .. }));
        }
    }
    assert!(found);
}

#[test]
fn repeated_concrete_references_do_not_consume_a_deferred_generic_form() {
    let snapshot = capture("a-closure-default-captures-its-parameter");
    let forms: Vec<_> = snapshot
        .types
        .iter()
        .enumerate()
        .filter(|(index, record)| {
            record
                .symbol
                .is_some_and(|symbol| snapshot.symbols[symbol.0 as usize].name.is_name("Box"))
                && snapshot
                    .type_arguments
                    .get(&TypeId(
                        u32::try_from(*index).expect("snapshot arena fits u32"),
                    ))
                    .is_some_and(|arguments| {
                        !arguments.is_empty()
                            && arguments.iter().all(|argument| {
                                matches!(
                                    snapshot.types[argument.0 as usize].kind,
                                    TypeKind::TypeParameter { .. }
                                )
                            })
                    })
        })
        .collect();
    assert_eq!(
        forms.len(),
        2,
        "both the class and the generic default's form are reached"
    );
    for (_, record) in forms {
        assert!(
            matches!(&record.kind, TypeKind::Object { properties } if properties.iter().any(|property| property.name.is_name("value"))),
            "a reached Box<T> form must carry its value member: {:?}",
            record.kind
        );
    }
}

#[test]
#[ignore = "whole-program corpus capture audit; run explicitly for a frontend switch"]
fn no_program_keeps_an_unrequested_reachable_type() {
    let mut names: Vec<_> = std::fs::read_dir(root().join("tests/programs"))
        .unwrap()
        .map(Result::unwrap)
        .filter(|entry| entry.path().join("tsconfig.json").is_file())
        .map(|entry| entry.file_name().into_string().unwrap())
        .collect();
    names.sort();
    let mut problems = Vec::new();
    for name in names {
        let snapshot = capture(&name);
        let missing = unrequested(&snapshot);
        if !missing.is_empty() {
            let records: Vec<_> = missing
                .iter()
                .map(|id| {
                    let record = &snapshot.types[id.0 as usize];
                    let symbol = record
                        .symbol
                        .map(|symbol| &snapshot.symbols[symbol.0 as usize]);
                    let returns: Vec<_> = snapshot
                        .signatures
                        .iter()
                        .enumerate()
                        .filter(|(_, signature)| signature.return_type == *id)
                        .collect();
                    let arguments: Vec<_> = snapshot
                        .type_arguments
                        .iter()
                        .filter(|(_, arguments)| arguments.contains(id))
                        .collect();
                    (
                        id,
                        record,
                        symbol,
                        returns,
                        arguments,
                        incoming_edges(&snapshot, *id),
                    )
                })
                .collect();
            problems.push(format!("{name}: {records:#?}"));
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
