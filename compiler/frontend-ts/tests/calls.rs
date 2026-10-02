//! Call-target resolution: which function a call site actually reaches.
//!
//! Skips without `NTS_TSGO`; see `tsgo_transport.rs` for how to build the pinned
//! binary.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::{SemanticSource, TsgoApi, tsgo::decompose::Budget};
use nts_semantic_schema::{NodeId, SemanticSnapshot, TypeKind};

fn snapshot() -> Option<SemanticSnapshot> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/calls/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/calls fixture is checked in");
    Some(
        TsgoApi::new(tsgo)
            .with_call_resolution(Budget::DEFAULT)
            .snapshot(&tsconfig)
            .expect("snapshot should succeed"),
    )
}

/// The name a call site is calling, read off its first child.
fn callee_name(snapshot: &SemanticSnapshot, site: NodeId) -> String {
    snapshot.nodes[site.0 as usize]
        .children
        .first()
        .and_then(|c| snapshot.nodes[c.0 as usize].text.clone())
        .unwrap_or_default()
}

#[test]
fn every_call_site_resolves_to_a_target() {
    let Some(snapshot) = snapshot() else { return };
    assert_eq!(
        snapshot.call_targets.len(),
        3,
        "the fixture has three calls"
    );
    for target in snapshot.call_targets.values() {
        assert!(
            (target.signature.0 as usize) < snapshot.signatures.len(),
            "call target points past the signature arena",
        );
    }
}

#[test]
fn overloads_resolve_to_different_signatures_per_call_site() {
    let Some(snapshot) = snapshot() else { return };
    // The property that makes a static call possible. `widen(1)` and `widen("s")`
    // share a name; a backend that could not tell them apart would have to box
    // the argument and dispatch, losing the exact call at both sites.
    let widens: Vec<_> = snapshot
        .call_targets
        .iter()
        .filter(|(site, _)| callee_name(&snapshot, **site) == "widen")
        .map(|(_, target)| target)
        .collect();
    assert_eq!(widens.len(), 2);

    let returns: Vec<&TypeKind> = widens
        .iter()
        .map(|t| {
            &snapshot.types[snapshot.signatures[t.signature.0 as usize].return_type.0 as usize].kind
        })
        .collect();
    assert!(
        returns.contains(&&TypeKind::Number) && returns.contains(&&TypeKind::String),
        "the two `widen` calls should reach the number and string overloads, got {returns:?}",
    );
}

#[test]
fn each_overload_points_at_its_own_declaration() {
    let Some(snapshot) = snapshot() else { return };
    let declarations: Vec<_> = snapshot
        .call_targets
        .iter()
        .filter(|(site, _)| callee_name(&snapshot, **site) == "widen")
        .filter_map(|(_, target)| target.callee)
        .collect();
    assert_eq!(
        declarations.len(),
        2,
        "both calls name a decoded declaration"
    );
    assert_ne!(
        declarations[0], declarations[1],
        "two overload call sites collapsed onto one declaration",
    );
}

#[test]
fn a_direct_call_names_the_function_it_reaches() {
    let Some(snapshot) = snapshot() else { return };
    let (_, target) = snapshot
        .call_targets
        .iter()
        .find(|(site, _)| callee_name(&snapshot, **site) == "helper")
        .expect("`helper(3)` is present");

    let callee = target.callee.expect("helper is declared in this file");
    let declaration = &snapshot.nodes[callee.0 as usize];
    assert_eq!(
        declaration.kind,
        nts_semantic_schema::NodeKind::Syntax(
            nts_frontend_ts::tsgo::types::syntax::FUNCTION_DECLARATION
        ),
    );

    let signature = &snapshot.signatures[target.signature.0 as usize];
    assert_eq!(signature.parameters.len(), 1);
    assert_eq!(
        &snapshot.types[signature.parameters[0].ty.0 as usize].kind,
        &TypeKind::Number,
    );
}

#[test]
fn syntax_kinds_still_match_the_pinned_tsgo() {
    use nts_frontend_ts::tsgo::types::syntax;
    use nts_semantic_schema::NodeKind::Syntax;

    let Some(snapshot) = snapshot() else { return };

    // The kind numbers were read off a real encoded program rather than
    // transcribed. A tsgo bump that renumbers them should fail here rather than
    // silently classify call expressions as something else.
    let has = |kind: u16| snapshot.nodes.iter().any(|n| n.kind == Syntax(kind));
    assert!(has(syntax::SOURCE_FILE), "SOURCE_FILE");
    assert!(has(syntax::FUNCTION_DECLARATION), "FUNCTION_DECLARATION");
    assert!(has(syntax::CALL_EXPRESSION), "CALL_EXPRESSION");
    assert!(has(syntax::IDENTIFIER), "IDENTIFIER");
    assert!(has(syntax::PARAMETER), "PARAMETER");
    assert!(has(syntax::RETURN_STATEMENT), "RETURN_STATEMENT");
}

/// `import("./lazy.ts")`: a call whose callee is the `import` keyword, typed by
/// the checker as `Promise<namespace>` -- and the namespace's symbol is the
/// imported module's root symbol, the same key `link_modules` resolves a static
/// import by. Dynamic import is lowered on exactly those two facts, so they are
/// asserted against a real encoded program rather than assumed.
#[test]
fn dynamic_import_calls_the_import_keyword() {
    use nts_frontend_ts::tsgo::types::syntax;
    use nts_semantic_schema::NodeKind::Syntax;

    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else { return };
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/a-dynamic-import/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/a-dynamic-import fixture is checked in");
    // Decomposed and call-resolved, as a build takes it: a bare snapshot leaves
    // the promise's type arguments out, and lowering never sees that one.
    let snapshot = TsgoApi::new(tsgo)
        .with_decomposition(Budget::DEFAULT)
        .with_call_resolution(Budget::DEFAULT)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");

    let calls: Vec<NodeId> = (0..snapshot.nodes.len())
        .map(|at| NodeId(u32::try_from(at).unwrap()))
        .filter(|id| snapshot.nodes[id.0 as usize].kind == Syntax(syntax::CALL_EXPRESSION))
        .filter(|id| {
            snapshot.nodes[id.0 as usize]
                .children
                .first()
                .is_some_and(|callee| snapshot.nodes[callee.0 as usize].kind == Syntax(syntax::IMPORT_KEYWORD))
        })
        .collect();
    assert!(calls.len() >= 6, "the fixture writes at least six `import(...)` calls, found {}", calls.len());

    let lazy = snapshot
        .modules
        .iter()
        .find(|module| snapshot.sources[module.file.0 as usize].uri.ends_with("/lazy.ts"))
        .expect("the fixture has a `lazy` module");
    let lazy_symbol = snapshot.nodes[lazy.root.0 as usize].symbol.expect("a module's root carries its symbol");
    let reaches_lazy = calls.iter().any(|call| {
        let Some(promise) = snapshot.node_types.get(call) else { return false };
        let Some(namespace) = snapshot.type_arguments.get(promise).and_then(|args| args.first()) else {
            return false;
        };
        snapshot.types[namespace.0 as usize].symbol == Some(lazy_symbol)
    });
    if !reaches_lazy {
        for call in &calls {
            let promise = snapshot.node_types.get(call);
            let args = promise.and_then(|p| snapshot.type_arguments.get(p));
            eprintln!(
                "call {call:?}: type {promise:?} {:?} args {args:?} -> {:?}; lazy root symbol {lazy_symbol:?}",
                promise.map(|p| &snapshot.types[p.0 as usize]),
                args.and_then(|a| a.first()).map(|t| (&snapshot.types[t.0 as usize].symbol, &snapshot.types[t.0 as usize].kind)),
            );
        }
    }
    assert!(reaches_lazy, "an `import(\"./lazy.ts\")` is typed Promise<namespace of `lazy`>");
}
