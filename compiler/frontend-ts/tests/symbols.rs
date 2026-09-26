//! Symbol resolution and module exports, against a real tsgo.
//!
//! Skips without `NTS_TSGO`; see `tsgo_transport.rs` for how to build the pinned
//! binary.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_semantic_schema::{SemanticSnapshot, SymbolFlags};

fn snapshot() -> Option<SemanticSnapshot> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/types/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/types fixture is checked in");
    Some(
        TsgoApi::new(tsgo)
            .snapshot(&tsconfig)
            .expect("snapshot should succeed"),
    )
}

#[test]
fn every_export_is_recorded_with_its_kind() {
    let Some(snapshot) = snapshot() else { return };
    let module = snapshot.modules.first().expect("one file, one module");

    let by_name = |name: &str| {
        let (_, id) = module
            .exports
            .iter()
            .find(|(n, _)| n == name)
            .unwrap_or_else(|| panic!("{name} is not exported"));
        snapshot.symbols[id.0 as usize].flags
    };

    assert!(by_name("Point").contains(SymbolFlags::INTERFACE));
    assert!(by_name("Status").contains(SymbolFlags::TYPE_ALIAS));
    for value in ["origin", "names", "state", "mixed"] {
        assert!(by_name(value).contains(SymbolFlags::VARIABLE), "{value}");
    }
    assert_eq!(module.exports.len(), 6);
}

#[test]
fn occurrences_of_one_binding_share_a_symbol() {
    let Some(snapshot) = snapshot() else { return };
    // This is the property HIR is blocked on: without it there is no way to say
    // that a declaration and a use name the same thing.
    let origins: Vec<_> = snapshot
        .nodes
        .iter()
        .filter(|node| node.text.as_deref() == Some("origin"))
        .filter_map(|node| node.symbol)
        .collect();
    assert!(!origins.is_empty(), "`origin` should carry a symbol");
    assert!(
        origins.windows(2).all(|w| w[0] == w[1]),
        "occurrences of one binding resolved to different symbols: {origins:?}",
    );
}

#[test]
fn distinct_bindings_with_the_same_name_stay_distinct() {
    let Some(snapshot) = snapshot() else { return };
    // `Point.x` and the `x` in the object literal are different bindings that
    // happen to share a name. Collapsing them would be worse than not resolving
    // at all, because it looks like it worked.
    let xs: Vec<_> = snapshot
        .nodes
        .iter()
        .filter(|node| node.text.as_deref() == Some("x"))
        .filter_map(|node| node.symbol)
        .collect();
    assert!(xs.len() >= 2, "the fixture declares `x` twice");
    assert!(
        xs.windows(2).any(|w| w[0] != w[1]),
        "two different `x` bindings collapsed onto one symbol",
    );
}

#[test]
fn every_symbol_knows_where_it_is_declared() {
    let Some(snapshot) = snapshot() else { return };
    for symbol in &snapshot.symbols {
        assert!(
            !symbol.declarations.is_empty(),
            "symbol {:?} has no declaration site",
            symbol.name,
        );
    }
}

#[test]
fn no_symbol_name_leaks_a_machine_path() {
    let Some(snapshot) = snapshot() else { return };
    // A module's own symbol is named by its path. RFC §20.4 forbids an absolute
    // machine path reaching an artifact, and a symbol name is an artifact.
    for symbol in &snapshot.symbols {
        assert!(
            !symbol.name.contains("/home/"),
            "symbol name leaked a home directory: {:?}",
            symbol.name,
        );
    }
}

#[test]
fn symbol_resolution_stays_linear_in_files() {
    let Some(tsgo) = std::env::var("NTS_TSGO").ok().map(Utf8PathBuf::from) else {
        return;
    };
    if !tsgo.exists() {
        return;
    }
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/types/tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let mut source = TsgoApi::new(tsgo);
    source.snapshot(&tsconfig).unwrap();
    let stats = source.stats();

    // Gate G1, extended. Two fixed exchanges, then four per file: getSourceFile,
    // getTypeAtLocations, getSymbolsAtLocations, getExportsOfModule. Symbols and
    // types both batch; if either stopped batching this would track node count.
    assert_eq!(stats.round_trips, 5 + 5 * u64::from(stats.files));
    assert!(stats.symbols > 0);
    assert_eq!(stats.modules, stats.files);
}

/// **A symbol declared in two files keeps both declarations.** A class in one
/// file and an interface merging into it from another -- a Swift extension,
/// as `AppKit` adds members to Foundation's `NSString` -- is one symbol, and it
/// used to keep only the declarations of the file it was first recorded
/// from: `AppKit`'s `NSString` lost its class and lowering found none, and here
/// the class's file first loses the interface. Both file orders, since which
/// one comes first decided it.
#[test]
fn a_symbol_declared_in_two_files_keeps_both_declarations() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else { return };
    for (order, files) in [("class-first", ["a.d.ts", "b.d.ts"]), ("interface-first", ["b.d.ts", "a.d.ts"])] {
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-symbols-merged-{}-{order}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.d.ts"), "declare module \"m\" {\n  export class Box {\n    a(): number;\n  }\n}\n").unwrap();
        std::fs::write(dir.join("b.d.ts"), "declare module \"m\" {\n  interface Box {\n    b(): number;\n  }\n}\n").unwrap();
        std::fs::write(dir.join("main.ts"), "import { Box } from \"m\";\nexport function both(box: Box): number {\n  return box.a() + box.b();\n}\n").unwrap();
        std::fs::write(
            dir.join("tsconfig.json"),
            format!(
                r#"{{ "compilerOptions": {{ "strict": true, "noEmit": true, "target": "es2022", "module": "esnext" }}, "files": ["{}", "{}", "main.ts"] }}"#,
                files[0], files[1]
            ),
        )
        .unwrap();
        let tsconfig = dir.join("tsconfig.json").canonicalize_utf8().unwrap();
        let snapshot = TsgoApi::new(tsgo.clone()).snapshot(&tsconfig).expect("snapshot should succeed");
        let kinds: Vec<u16> = snapshot
            .symbols
            .iter()
            .filter(|symbol| symbol.name == "Box")
            .flat_map(|symbol| symbol.declarations.iter())
            .filter_map(|node| match snapshot.nodes[node.0 as usize].kind {
                nts_semantic_schema::NodeKind::Syntax(kind) => Some(kind),
                nts_semantic_schema::NodeKind::List => None,
            })
            .collect();
        for (kind, what) in [(nts_semantic_schema::syntax::CLASS_DECLARATION, "class"), (nts_semantic_schema::syntax::INTERFACE_DECLARATION, "interface")] {
            assert!(kinds.contains(&kind), "{order}: `Box` lost its {what} declaration: {kinds:?}");
        }
    }
}
