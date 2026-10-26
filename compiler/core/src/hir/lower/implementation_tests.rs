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
