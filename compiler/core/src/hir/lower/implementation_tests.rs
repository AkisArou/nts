//! Controls for the sibling relation used to resolve overload implementations.
//!
//! The native sibling cases reproduce the quadratic lowering walk without GIR.
//! The explicit answer controls protect the relation while its lookup changes.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{
    DeclarationModifiers, NodeData, NodeId, NodeKind, NodeRecord, Origin, SemanticSnapshot, syntax,
};

use super::FuncBuilder;

// The shared CallSignature kind, unnamed in the shared syntax table.
const CALL_SIGNATURE: u16 = 180;

// Keep the original scan as an independent oracle when production switches
// to an index. In particular, do not borrow cached names or body answers.
fn old_scan(probe: &FuncBuilder<'_>, callee: NodeId) -> NodeId {
    let has_body = |node: NodeId| {
        probe
            .children(node)
            .into_iter()
            .any(|child| probe.kind_of(child) == Some(syntax::BLOCK))
    };
    if has_body(callee) {
        return callee;
    }
    let named = |node: NodeId| {
        if probe.kind_of(node) == Some(syntax::CONSTRUCTOR) {
            return Some(super::CONSTRUCTOR_KEY.to_owned());
        }
        probe
            .children(node)
            .into_iter()
            .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| {
                probe
                    .node(child)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            })
    };
    let (Some(parent), Some(name)) = (probe.syntactic_parent(callee), named(callee)) else {
        return callee;
    };
    probe
        .children(parent)
        .into_iter()
        .find(|sibling| {
            *sibling != callee
                && has_body(*sibling)
                && named(*sibling).as_deref() == Some(name.as_str())
        })
        .unwrap_or(callee)
}

fn node(snapshot: &mut SemanticSnapshot, kind: NodeKind, parent: Option<NodeId>) -> NodeId {
    let id = NodeId(u32::try_from(snapshot.nodes.len()).unwrap());
    snapshot.nodes.push(NodeRecord {
        kind,
        origin: Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 0),
        }),
        parent,
        children: Vec::new(),
        symbol: None,
        flags: 0,
        modifiers: DeclarationModifiers::default(),
        native: None,
        data: NodeData::Children {
            present: 0,
            small: 0,
        },
        text: None,
    });
    if let Some(parent) = parent {
        snapshot.nodes[parent.0 as usize].children.push(id);
    }
    id
}

fn scope(snapshot: &mut SemanticSnapshot) -> NodeId {
    let block = node(snapshot, NodeKind::Syntax(syntax::MODULE_DECLARATION), None);
    node(snapshot, NodeKind::List, Some(block))
}

fn declaration(
    snapshot: &mut SemanticSnapshot,
    parent: NodeId,
    kind: u16,
    name: Option<&str>,
    body: bool,
) -> NodeId {
    let id = node(snapshot, NodeKind::Syntax(kind), Some(parent));
    if let Some(name) = name {
        let ident = node(snapshot, NodeKind::Syntax(syntax::IDENTIFIER), Some(id));
        snapshot.nodes[ident.0 as usize].text = Some(name.into());
    }
    if body {
        node(snapshot, NodeKind::Syntax(syntax::BLOCK), Some(id));
    }
    id
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one snapshot discriminates sibling order, constructors, and nested lists"
)]
fn implementation_answers_keep_sibling_order_and_native_controls() {
    let mut snapshot = SemanticSnapshot::default();
    let members = scope(&mut snapshot);
    let signature = declaration(
        &mut snapshot,
        members,
        syntax::FUNCTION_DECLARATION,
        Some("pick"),
        false,
    );
    let first = declaration(
        &mut snapshot,
        members,
        syntax::FUNCTION_DECLARATION,
        Some("pick"),
        true,
    );
    let second = declaration(
        &mut snapshot,
        members,
        syntax::FUNCTION_DECLARATION,
        Some("pick"),
        true,
    );
    let native = declaration(
        &mut snapshot,
        members,
        syntax::FUNCTION_DECLARATION,
        Some("external"),
        false,
    );
    let ctor_signature = declaration(&mut snapshot, members, syntax::CONSTRUCTOR, None, false);
    let ctor_body = declaration(&mut snapshot, members, syntax::CONSTRUCTOR, None, true);
    let other_members = scope(&mut snapshot);
    let outside = declaration(
        &mut snapshot,
        other_members,
        syntax::FUNCTION_DECLARATION,
        Some("external"),
        true,
    );
    let unnamed = declaration(
        &mut snapshot,
        members,
        syntax::METHOD_DECLARATION,
        None,
        false,
    );
    // The first identifier is decisive even when it has no text. A later
    // identifier must not make this declaration accidentally match `pick`.
    node(
        &mut snapshot,
        NodeKind::Syntax(syntax::IDENTIFIER),
        Some(unnamed),
    );
    let later = node(
        &mut snapshot,
        NodeKind::Syntax(syntax::IDENTIFIER),
        Some(unnamed),
    );
    snapshot.nodes[later.0 as usize].text = Some("pick".into());
    let nested = node(&mut snapshot, NodeKind::List, Some(members));
    let nested_signature = declaration(
        &mut snapshot,
        nested,
        syntax::FUNCTION_DECLARATION,
        Some("nested"),
        false,
    );
    let nested_body = declaration(
        &mut snapshot,
        members,
        syntax::FUNCTION_DECLARATION,
        Some("nested"),
        true,
    );
    let hidden_signature = declaration(
        &mut snapshot,
        members,
        syntax::FUNCTION_DECLARATION,
        Some("hidden"),
        false,
    );
    declaration(
        &mut snapshot,
        nested,
        syntax::FUNCTION_DECLARATION,
        Some("hidden"),
        true,
    );
    let indexed = super::LoweringSnapshot::new(&snapshot);
    let probe = FuncBuilder::probe(&indexed);
    for (given, expected) in [
        (signature, first),
        (first, first),
        (second, second),
        (native, native),
        (ctor_signature, ctor_body),
        (ctor_body, ctor_body),
        (outside, outside),
        (unnamed, unnamed),
        (nested_signature, nested_body),
        // Syntactic parents skip every List, but children flatten only one.
        (hidden_signature, hidden_signature),
    ] {
        assert_eq!(probe.implementation_of(given), expected, "{given:?}");
    }
    for at in 0..snapshot.nodes.len() {
        let given = NodeId(u32::try_from(at).unwrap());
        assert_eq!(probe.implementation_of(given), old_scan(&probe, given));
    }
}

#[test]
fn every_native_sibling_without_a_body_is_its_own_implementation() {
    for count in [500, 1_000, 2_000] {
        let mut snapshot = SemanticSnapshot::default();
        let members = scope(&mut snapshot);
        let declarations: Vec<_> = (0..count)
            .map(|at| {
                declaration(
                    &mut snapshot,
                    members,
                    syntax::FUNCTION_DECLARATION,
                    Some(&format!("f{at}")),
                    false,
                )
            })
            .collect();
        let indexed = super::LoweringSnapshot::new(&snapshot);
        let probe = FuncBuilder::probe(&indexed);
        for given in declarations {
            assert_eq!(
                probe.implementation_of(given),
                given,
                "N={count}, {given:?}"
            );
            assert_eq!(probe.implementation_of(given), old_scan(&probe, given));
        }
    }
}

/// Run explicitly with `NTS_IMPLEMENTATION_PROJECTS` naming the three measured
/// native-sibling tsconfigs and a Gtk-4.0 tsconfig listing the generated files.
/// It deliberately fails if the requested inputs or the Gtk surface are absent.
#[test]
#[ignore = "full GIR surface: supply NTS_IMPLEMENTATION_PROJECTS"]
fn measured_native_and_gtk_declarations_match_the_old_scan() {
    use nts_frontend_ts::Frontend;

    let configs = std::env::var_os("NTS_IMPLEMENTATION_PROJECTS")
        .expect("NTS_IMPLEMENTATION_PROJECTS must name the measured projects");
    let mut projects = 0;
    let mut gtk_declarations = 0;
    for config in std::env::split_paths(&configs) {
        let config = camino::Utf8PathBuf::from_path_buf(config).expect("UTF-8 tsconfig path");
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("snapshot must succeed");
        assert!(!snapshot.has_errors(), "{config} must typecheck");
        let has_gtk = snapshot
            .sources
            .iter()
            .any(|source| source.display_path.as_str().contains("/gi-gtk/index.d.ts"));
        let indexed = super::LoweringSnapshot::new(&snapshot);
        let probe = FuncBuilder::probe(&indexed);
        let mut declarations = 0;
        for (at, node) in snapshot.nodes.iter().enumerate() {
            if !matches!(
                node.kind,
                NodeKind::Syntax(
                    syntax::FUNCTION_DECLARATION
                        | syntax::METHOD_DECLARATION
                        | syntax::METHOD_SIGNATURE
                        | syntax::CONSTRUCTOR
                        | syntax::GET_ACCESSOR
                        | syntax::SET_ACCESSOR
                        | CALL_SIGNATURE
                        | syntax::CONSTRUCT_SIGNATURE
                )
            ) {
                continue;
            }
            let given = NodeId(u32::try_from(at).unwrap());
            assert_eq!(
                probe.implementation_of(given),
                old_scan(&probe, given),
                "{config}: {given:?}"
            );
            declarations += 1;
        }
        assert!(declarations > 0, "{config}: no declarations checked");
        if has_gtk {
            gtk_declarations += declarations;
        }
        projects += 1;
        eprintln!("{config}: {declarations} declaration answers equal");
    }
    assert_eq!(projects, 4, "three sibling cases and one Gtk surface");
    assert!(
        gtk_declarations >= 38_416,
        "full Gtk surface must be checked"
    );
}

fn query_symbol(
    snapshot: &mut SemanticSnapshot,
    name: &str,
    flags: nts_semantic_schema::SymbolFlags,
    declaration: NodeId,
) -> nts_semantic_schema::SymbolId {
    let id = nts_semantic_schema::SymbolId(u32::try_from(snapshot.symbols.len()).unwrap());
    snapshot.symbols.push(nts_semantic_schema::SymbolRecord {
        name: name.into(),
        flags,
        builtin: None,
        declarations: vec![declaration],
        declaration_sites: Vec::new(),
        ty: None,
        aliased: None,
        library: None,
    });
    id
}

#[test]
fn a_declared_base_is_found_after_more_than_64_class_children() {
    for members in [8, 80] {
        let mut snapshot = SemanticSnapshot::default();
        let base = node(
            &mut snapshot,
            NodeKind::Syntax(syntax::CLASS_DECLARATION),
            None,
        );
        let symbol = query_symbol(
            &mut snapshot,
            "Base",
            nts_semantic_schema::SymbolFlags::CLASS,
            base,
        );
        let child = node(
            &mut snapshot,
            NodeKind::Syntax(syntax::CLASS_DECLARATION),
            None,
        );
        let heritage = node(
            &mut snapshot,
            NodeKind::Syntax(syntax::HERITAGE_CLAUSE),
            Some(child),
        );
        let applied = node(
            &mut snapshot,
            NodeKind::Syntax(syntax::EXPRESSION_WITH_TYPE_ARGUMENTS),
            Some(heritage),
        );
        let named = node(
            &mut snapshot,
            NodeKind::Syntax(syntax::IDENTIFIER),
            Some(applied),
        );
        snapshot.nodes[named.0 as usize].symbol = Some(symbol);
        for _ in 0..members {
            node(
                &mut snapshot,
                NodeKind::Syntax(syntax::METHOD_DECLARATION),
                Some(child),
            );
        }
        let indexed = super::LoweringSnapshot::new(&snapshot);
        let probe = FuncBuilder::probe(&indexed);
        assert_eq!(
            super::declared_base_class(&snapshot, &probe, child),
            Some(symbol.0),
            "{members} members"
        );
    }
}

#[test]
fn a_const_function_chain_longer_than_eight_hops_keeps_its_body() {
    for hops in [3, 40] {
        let mut snapshot = SemanticSnapshot::default();
        let body = node(
            &mut snapshot,
            NodeKind::Syntax(syntax::FUNCTION_DECLARATION),
            None,
        );
        node(&mut snapshot, NodeKind::Syntax(syntax::BLOCK), Some(body));
        let mut previous = query_symbol(
            &mut snapshot,
            "raises",
            nts_semantic_schema::SymbolFlags::default(),
            body,
        );
        let mut final_initializer = None;
        for at in 0..hops {
            let list = node(
                &mut snapshot,
                NodeKind::Syntax(syntax::VARIABLE_DECLARATION_LIST),
                None,
            );
            snapshot.nodes[list.0 as usize].flags =
                nts_semantic_schema::VariableKind::Const.node_flags();
            let declaration = node(
                &mut snapshot,
                NodeKind::Syntax(syntax::VARIABLE_DECLARATION),
                Some(list),
            );
            let named = node(
                &mut snapshot,
                NodeKind::Syntax(syntax::IDENTIFIER),
                Some(declaration),
            );
            snapshot.nodes[named.0 as usize].text = Some(format!("alias{at}").into());
            let initializer = node(
                &mut snapshot,
                NodeKind::Syntax(syntax::IDENTIFIER),
                Some(declaration),
            );
            snapshot.nodes[initializer.0 as usize].symbol = Some(previous);
            let symbol = query_symbol(
                &mut snapshot,
                &format!("alias{at}"),
                nts_semantic_schema::SymbolFlags::default(),
                declaration,
            );
            snapshot.nodes[named.0 as usize].symbol = Some(symbol);
            previous = symbol;
            final_initializer = Some(initializer);
        }
        let indexed = super::LoweringSnapshot::new(&snapshot);
        let probe = FuncBuilder::probe(&indexed);
        assert_eq!(
            super::function_behind_const(&probe, previous.0),
            Some(body),
            "{hops} hops"
        );
        // A cycle has no terminal function and must complete without recursion.
        snapshot.nodes[final_initializer.unwrap().0 as usize].symbol = Some(previous);
        let indexed = super::LoweringSnapshot::new(&snapshot);
        let probe = FuncBuilder::probe(&indexed);
        assert_eq!(super::function_behind_const(&probe, previous.0), None);
    }
}

#[test]
fn hierarchy_queries_visit_the_full_base_chain() {
    use super::super::member_key::MemberKey;
    use nts_semantic_schema::TypeId;
    for depth in [8, 80] {
        let mut hierarchy = super::Hierarchy::default();
        for child in 1..=depth {
            hierarchy.base.insert(TypeId(child), TypeId(child - 1));
        }
        let member = MemberKey::named("m");
        hierarchy.declares.insert(TypeId(0), vec![member.clone()]);
        hierarchy
            .declares
            .insert(TypeId(depth), vec![member.clone()]);
        hierarchy.constructs.insert(TypeId(0));
        hierarchy.provided_errors.insert(TypeId(0), 0);
        hierarchy
            .slots
            .insert((TypeId(0), member.clone(), false), 7);
        assert!(hierarchy.descends(TypeId(depth), TypeId(0)), "{depth}");
        assert!(hierarchy.descends_from(TypeId(depth), TypeId(0)), "{depth}");
        assert!(hierarchy.is_an_error(TypeId(depth)), "{depth}");
        assert_eq!(
            hierarchy.declaring(TypeId(depth), &member),
            Some(TypeId(depth))
        );
        assert_eq!(
            hierarchy.root_declaring(TypeId(depth), &member),
            Some(TypeId(0))
        );
        assert_eq!(hierarchy.slot_for(TypeId(depth), &member, false), Some(7));
        assert_eq!(hierarchy.constructor(TypeId(depth)), Some(TypeId(0)));
        assert!(!hierarchy.descends(TypeId(0), TypeId(depth)));
        assert_eq!(
            hierarchy.declaring(TypeId(depth), &MemberKey::named("absent")),
            None
        );
        // A malformed cycle visits each distinct node once instead of hanging.
        hierarchy.base.insert(TypeId(0), TypeId(depth));
        assert_eq!(
            hierarchy.ancestors(TypeId(depth)).count(),
            depth as usize + 1
        );
        assert!(!hierarchy.descends(TypeId(depth), TypeId(depth + 1)));
    }
}

#[test]
fn hierarchy_queries_visit_every_inherited_interface() {
    use super::super::member_key::MemberKey;
    use nts_semantic_schema::TypeId;
    for depth in [8, 80] {
        let mut hierarchy = super::Hierarchy::default();
        for child in 1..=depth {
            hierarchy
                .implements
                .insert(TypeId(child), vec![TypeId(child - 1)]);
        }
        hierarchy.faces.extend((0..=depth).map(TypeId));
        let member = MemberKey::named("m");
        hierarchy.declares.insert(TypeId(0), vec![member.clone()]);
        assert!(
            hierarchy.implements_transitively(TypeId(depth), TypeId(0)),
            "{depth}"
        );
        assert!(hierarchy.descends_from(TypeId(depth), TypeId(0)), "{depth}");
        assert_eq!(
            hierarchy.declaring_above(TypeId(depth), &member),
            Some(TypeId(0))
        );
        assert_eq!(
            hierarchy.root_declaring(TypeId(depth), &member),
            Some(TypeId(0))
        );
        assert_eq!(
            hierarchy.interfaces_of(TypeId(depth)),
            (0..depth).map(TypeId).collect::<Vec<_>>()
        );
        hierarchy.implements.insert(TypeId(0), vec![TypeId(depth)]);
        assert_eq!(
            hierarchy.interfaces_of(TypeId(depth)).len(),
            depth as usize + 1
        );
        assert!(!hierarchy.implements_transitively(TypeId(depth), TypeId(depth + 1)));
    }
}

#[test]
fn constructorless_initialization_keeps_every_ancestor() {
    use nts_semantic_schema::TypeId;
    let snapshot = SemanticSnapshot::default();
    let indexed = super::LoweringSnapshot::new(&snapshot);
    let mut probe = FuncBuilder::probe(&indexed);
    for child in 1..=80 {
        probe
            .hierarchy
            .base
            .insert(TypeId(child), TypeId(child - 1));
    }
    for depth in [8, 80] {
        assert_eq!(
            probe.constructorless_ancestors(Some(TypeId(depth))),
            (0..=depth).map(TypeId).collect::<Vec<_>>()
        );
        assert!(probe.extends(TypeId(depth), TypeId(0)));
    }
    assert_eq!(probe.constructorless_ancestors(None), Vec::<TypeId>::new());
}
