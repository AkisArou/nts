//! Actual lowering populations for complete class collection and inherited
//! constructor-target membership. Values sharing storage retain class identity.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::{cell::Cell, fmt::Write as _};

thread_local! {
    static CLASSES: Cell<usize> = const { Cell::new(0) };
    static TARGETS: Cell<usize> = const { Cell::new(0) };
    static ANCESTRY: Cell<usize> = const { Cell::new(0) };
    static ALIAS_LINKS: Cell<usize> = const { Cell::new(0) };
    static DISCOVERY_BINDINGS: Cell<(usize, usize)> = const { Cell::new((0, 0)) };
    static DISCOVERY_RETAINED: Cell<usize> = const { Cell::new(0) };
}
pub(super) fn note_class() {
    CLASSES.with(|n| n.set(n.get() + 1));
}
pub(super) fn note_target() {
    TARGETS.with(|n| n.set(n.get() + 1));
}
pub(super) fn note_ancestor() {
    ANCESTRY.with(|n| n.set(n.get() + 1));
}
pub(super) fn note_alias_link() {
    ALIAS_LINKS.with(|n| n.set(n.get() + 1));
}
pub(super) fn note_discovery_bindings(count: usize) {
    DISCOVERY_BINDINGS.with(|n| {
        let (total, peak) = n.get();
        n.set((total + count, peak.max(count)));
    });
}
pub(super) fn note_discovery_retained(count: usize) {
    DISCOVERY_RETAINED.with(|n| n.set(count));
}

#[test]
fn new_callee_alias_discovery_is_shared_by_the_constructor_collector() {
    let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut reports = Vec::new();
    for aliases in [false, true] {
        for count in [16, 64, 256] {
            let dir = std::env::temp_dir().join(format!(
                "nts-constructor-discovery-{}-{aliases}-{count}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let mut source = String::from(
                "class Base extends Uint8Array { constructor(n: number) { super(n); } }\nclass View extends Base {}\nconst Alias0 = View;\n",
            );
            for at in 1..count {
                writeln!(source, "const Alias{at} = Alias{};", at - 1).unwrap();
            }
            let callee = if aliases {
                format!("Alias{}", count - 1)
            } else {
                "View".to_owned()
            };
            for at in 0..count {
                writeln!(source, "export function probe{at}(n: number): number {{ return new {callee}((n & 3) + 1).length; }}").unwrap();
            }
            std::fs::write(dir.join("main.ts"), source).unwrap();
            let config = dir.join("tsconfig.json");
            std::fs::write(
                &config,
                format!(
                    "{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"
                ),
            )
            .unwrap();
            let semantic = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
                .with_checkers(std::num::NonZeroU16::MIN)
                .snapshot(camino::Utf8Path::from_path(&config).unwrap())
                .unwrap();
            let snapshot = super::LoweringSnapshot::new(&semantic);
            let probe = super::FuncBuilder::probe(&snapshot);
            let class = (0..snapshot.nodes.len())
                .map(|at| super::NodeId(u32::try_from(at).unwrap()))
                .find(|at| {
                    probe.kind_of(*at).is_some_and(super::declares_a_class)
                        && probe.class_name(*at).as_deref() == Some("View")
                })
                .unwrap();
            let target = super::instance_type_of(&snapshot, class).unwrap();
            ALIAS_LINKS.with(|n| n.set(0));
            DISCOVERY_BINDINGS.with(|n| n.set((0, 0)));
            DISCOVERY_RETAINED.with(|n| n.set(0));
            let targets = super::constructor_targets(&probe);
            assert_eq!(targets.len(), 1);
            assert_eq!(targets.values().next().unwrap(), &[target]);
            let links = ALIAS_LINKS.with(Cell::get);
            let (materialized, peak) = DISCOVERY_BINDINGS.with(Cell::get);
            let retained = DISCOVERY_RETAINED.with(Cell::get);
            eprintln!(
                "new callee population {count} aliases={aliases}: alias links {links}, materialized bindings {materialized}, peak temporary bindings {peak}, retained index bindings {retained}"
            );
            reports.push((count, aliases, links, materialized, peak, retained));
            std::fs::remove_dir_all(dir).unwrap();
        }
    }
    for (count, aliases, links, materialized, peak, retained) in reports {
        assert!(
            links <= count * 2 + 2,
            "collector discovery repeats alias links at {count}"
        );
        assert_eq!(
            materialized, 0,
            "discovery needs identity, not a binding Vec"
        );
        assert_eq!(peak, 0, "no transient executable proof at discovery");
        assert_eq!(retained, if aliases { count } else { 0 });
    }
}

#[test]
fn distinct_and_sibling_view_classes_have_linear_collection_work() {
    let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for siblings in [false, true] {
        for count in [16, 64, 256] {
            let dir = std::env::temp_dir().join(format!(
                "nts-view-relations-{}-{siblings}-{count}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let mut source = String::new();
            if siblings {
                source.push_str(
                    "class Base extends Uint8Array { constructor(n: number) { super(n); } }\n",
                );
            }
            for at in 0..count {
                let base = if siblings { "Base" } else { "Uint8Array" };
                writeln!(source, "class View{at} extends {base} {{}}\nexport function probe{at}(n: number): boolean {{ return new View{at}((n & 3) + 1) instanceof View{at}; }}").unwrap();
            }
            std::fs::write(dir.join("main.ts"), source).unwrap();
            let config = dir.join("tsconfig.json");
            std::fs::write(
                &config,
                format!(
                    "{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"
                ),
            )
            .unwrap();
            let config = camino::Utf8Path::from_path(&config).unwrap();
            let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
                .with_checkers(std::num::NonZeroU16::MIN)
                .snapshot(config)
                .unwrap();
            CLASSES.with(|n| n.set(0));
            TARGETS.with(|n| n.set(0));
            let lowered = super::lower(&snapshot);
            assert!(
                lowered.program.uncompiled.is_empty(),
                "{:?}",
                lowered.program.uncompiled
            );
            assert_eq!(
                lowered.program.view_classes.iter().count(),
                count + usize::from(siblings)
            );
            for view in &lowered.program.view_classes {
                if let Some(base) = view.base {
                    assert!(
                        lowered.program.view_classes.get(base).is_some(),
                        "unnamed ancestors are still emitted"
                    );
                }
            }
            if siblings {
                assert!(
                    lowered.program.constructed_as.len() >= count,
                    "each sibling gets its inherited constructor target"
                );
            }
            let classes = CLASSES.with(Cell::get);
            let targets = TARGETS.with(Cell::get);
            eprintln!(
                "view population {count} siblings={siblings}: class visits={classes} target memberships={targets}"
            );
            assert!(classes <= count * 8 + 4);
            assert!(targets <= count * 2);
            std::fs::remove_dir_all(dir).unwrap();
        }
    }
}

#[test]
fn constructor_target_membership_is_unique_and_published_in_order() {
    let mut reports = Vec::new();
    for count in [16, 64, 256] {
        TARGETS.with(|n| n.set(0));
        let mut targets = super::ConstructorTargets::default();
        for at in (0..count).rev() {
            targets.insert(super::NodeId(1), super::TypeId(at));
            targets.insert(super::NodeId(1), super::TypeId(at));
        }
        let rows = targets.finish();
        assert_eq!(
            rows[&super::NodeId(1)],
            (0..count).map(super::TypeId).collect::<Vec<_>>()
        );
        let memberships = TARGETS.with(Cell::get);
        eprintln!("constructor target set {count}: membership work {memberships}");
        reports.push((count, memberships));
    }
    for (count, memberships) in reports {
        assert_eq!(memberships, count as usize * 2);
    }
}

#[test]
fn deep_implicit_constructor_ancestry_is_resolved_once() {
    let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut reports = Vec::new();
    for count in [16, 64, 256] {
        let dir =
            std::env::temp_dir().join(format!("nts-view-implicit-{}-{count}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut source = String::from(
            "class Base extends Uint8Array { constructor(n: number) { super(n); } }\n",
        );
        for at in 0..count {
            let base = if at == 0 {
                "Base".to_owned()
            } else {
                format!("View{}", at - 1)
            };
            writeln!(source, "class View{at} extends {base} {{}}\nexport function probe{at}(n: number): number {{ return new View{at}((n & 3) + 1).length; }}").unwrap();
        }
        std::fs::write(dir.join("main.ts"), source).unwrap();
        let config = dir.join("tsconfig.json");
        std::fs::write(
            &config,
            format!("{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"),
        )
        .unwrap();
        let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(camino::Utf8Path::from_path(&config).unwrap())
            .unwrap();
        let indexed = super::LoweringSnapshot::new(&snapshot);
        let probe = super::FuncBuilder::probe(&indexed);
        ANCESTRY.with(|n| n.set(0));
        let targets = super::constructor_targets(&probe);
        assert_eq!(targets.values().map(Vec::len).sum::<usize>(), count);
        let ancestry = ANCESTRY.with(Cell::get);
        eprintln!("implicit constructor depth {count}: actual collector ancestry steps {ancestry}");
        reports.push((count, ancestry));
        let lowered = super::lower(&snapshot);
        assert!(
            lowered.program.uncompiled.is_empty(),
            "{:?}",
            lowered.program.uncompiled
        );
        assert_eq!(lowered.program.constructed_as.len(), count);
        std::fs::remove_dir_all(dir).unwrap();
    }
    for (count, ancestry) in reports {
        assert!(
            ancestry <= count * 4 + 4,
            "collector ancestry repeats across implicit subclasses"
        );
    }
}

#[test]
fn native_constructor_memo_keeps_instance_and_projection_contexts_separate() {
    let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/a-typed-array-subclass-is-made-as-the-class-its-new-names/tsconfig.json");
    let semantic = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let snapshot = super::LoweringSnapshot::new(&semantic);
    let probe = super::FuncBuilder::probe(&snapshot);
    let class = |name: &str| {
        (0..snapshot.nodes.len())
            .map(|at| super::NodeId(u32::try_from(at).unwrap()))
            .find(|at| {
                probe.kind_of(*at).is_some_and(super::declares_a_class)
                    && probe.class_name(*at).as_deref() == Some(name)
            })
            .unwrap()
    };
    let parent = class("Counted");
    let child = class("Octets");
    let parent_ty = super::instance_type_of(&snapshot, parent).unwrap();
    let child_ty = super::instance_type_of(&snapshot, child).unwrap();
    let valid = super::made_instance::ConstructorMemo::new(&probe).of(child);
    assert!(
        matches!(valid, Some(super::CollectedConstructor::Source { class, .. }) if class == parent)
    );
    let mut instance_context = super::FuncBuilder::probe(&snapshot);
    instance_context
        .substitution
        .test_instance(parent_ty, child_ty);
    assert!(matches!(
        instance_context.represent(parent_ty),
        Some(super::HirType::Managed(super::ManagedType::Object(_)))
    ));
    assert!(
        super::made_instance::ConstructorMemo::new(&instance_context)
            .of(child)
            .is_none(),
        "same parent identity, contextual Object storage"
    );
    let mut face_context = super::FuncBuilder::probe(&snapshot);
    face_context.hierarchy.cast_faces.insert(parent_ty);
    if cfg!(debug_assertions) {
        // Debug builds reject this deliberately malformed field-face context
        // before a constructor can be selected.
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                super::made_instance::ConstructorMemo::new(&face_context).of(child)
            }))
            .is_err()
        );
    } else {
        assert_eq!(
            face_context.represent(parent_ty),
            Some(super::HirType::Erased)
        );
        assert!(
            super::made_instance::ConstructorMemo::new(&face_context)
                .of(child)
                .is_none(),
            "same parent identity, contextual erased storage"
        );
    }
    assert!(
        super::made_instance::ConstructorMemo::new(&probe)
            .of(child)
            .is_some(),
        "a failed context must not poison the original one"
    );
}

fn alias_proof_population(siblings: bool, prefixes: bool) -> Vec<(usize, usize, usize, usize)> {
    let mut reports = Vec::new();
    let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for count in [16, 64, 256] {
        let dir = std::env::temp_dir().join(format!(
            "nts-view-alias-proof-{}-{siblings}-{prefixes}-{count}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mut source = String::from("const Alias0 = Uint8Array;\n");
        for at in 1..count {
            writeln!(source, "const Alias{at} = Alias{};", at - 1).unwrap();
        }
        for at in 0..count {
            let base = if prefixes {
                format!("Alias{at}")
            } else if siblings || at == 0 {
                format!("Alias{}", count - 1)
            } else {
                format!("View{}", at - 1)
            };
            writeln!(source, "class View{at} extends {base} {{}}").unwrap();
        }
        source.push_str("export function present(n: number): number { return n; }\n");
        std::fs::write(dir.join("main.ts"), source).unwrap();
        let config = dir.join("tsconfig.json");
        std::fs::write(
            &config,
            format!("{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"),
        )
        .unwrap();
        let semantic = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(camino::Utf8Path::from_path(&config).unwrap())
            .unwrap();
        let snapshot = super::LoweringSnapshot::new(&semantic);
        let probe = super::FuncBuilder::probe(&snapshot);
        let classes: Vec<_> = (0..snapshot.nodes.len())
            .map(|at| super::NodeId(u32::try_from(at).unwrap()))
            .filter(|at| {
                probe.kind_of(*at).is_some_and(super::declares_a_class)
                    && probe
                        .class_name(*at)
                        .is_some_and(|name| name.starts_with("View"))
            })
            .collect();
        assert_eq!(classes.len(), count);
        ANCESTRY.with(|n| n.set(0));
        ALIAS_LINKS.with(|n| n.set(0));
        let mut constructors = super::made_instance::ConstructorMemo::new(&probe);
        // Deepest first: one cold path fills every memo row, then all hits.
        for class in classes.iter().copied().rev() {
            assert!(matches!(
                constructors.of(class),
                Some(super::CollectedConstructor::Builtin)
            ));
        }
        let ancestry = ANCESTRY.with(Cell::get);
        let owned = constructors.owned_binding_elements();
        let alias_links = ALIAS_LINKS.with(Cell::get);
        eprintln!(
            "alias depth/classes {count} siblings={siblings} prefixes={prefixes}: ancestry {ancestry}, alias links {alias_links}, owned binding elements {owned}"
        );
        reports.push((count, ancestry, alias_links, owned));
        for class in &classes {
            let base = probe.extends_operand(*class).unwrap();
            let ordinary = probe.referenced_value(base).unwrap();
            assert_eq!(
                constructors.binding_path(*class),
                ordinary.bindings,
                "binding readiness order"
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    reports
}

#[test]
fn a_long_builtin_alias_proof_is_owned_once_across_an_implicit_chain() {
    for (count, ancestry, links, owned) in alias_proof_population(false, false) {
        assert!(ancestry <= count + 1);
        assert!(
            links <= count * 2 + 2,
            "alias links {links} exceed input at {count}"
        );
        assert_eq!(owned, count, "one owned alias proof, not one per class");
    }
}

#[test]
fn a_long_builtin_alias_proof_is_shared_by_sibling_classes() {
    for (count, ancestry, links, owned) in alias_proof_population(true, false) {
        assert!(ancestry <= count + 1);
        assert!(
            links <= count * 2 + 2,
            "alias links {links} exceed input at {count}"
        );
        assert_eq!(owned, count, "one owned alias proof, not one per sibling");
    }
}

#[test]
fn distinct_alias_prefixes_share_their_binding_suffixes() {
    for (count, ancestry, links, owned) in alias_proof_population(true, true) {
        assert!(ancestry <= count + 1);
        assert!(
            links <= count * 2 + 2,
            "alias links {links} exceed input at {count}"
        );
        assert_eq!(owned, count, "all alias prefixes own each link once");
    }
}

#[test]
fn reference_index_reuses_ordered_paths_and_caches_cycles_and_missing_symbols() {
    let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir = std::env::temp_dir().join(format!(
        "nts-reference-index-negative-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("main.ts"), "const Alias0 = Uint8Array; const Alias1 = Alias0; const Alias2 = Alias1; class View extends Alias2 {} export function present(n: number): number { return n; }").unwrap();
    let config = dir.join("tsconfig.json");
    std::fs::write(
        &config,
        format!("{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"),
    )
    .unwrap();
    let semantic = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(camino::Utf8Path::from_path(&config).unwrap())
        .unwrap();
    let snapshot = super::LoweringSnapshot::new(&semantic);
    let probe = super::FuncBuilder::probe(&snapshot);
    let class = (0..snapshot.nodes.len())
        .map(|at| super::NodeId(u32::try_from(at).unwrap()))
        .find(|at| {
            probe.kind_of(*at).is_some_and(super::declares_a_class)
                && probe.class_name(*at).as_deref() == Some("View")
        })
        .unwrap();
    let base = probe.extends_operand(class).unwrap();
    let ordinary = probe.referenced_value(base).unwrap();
    let mut references = super::reference_index::References::new(&probe);
    assert_eq!(references.of(base).unwrap().symbol, ordinary.symbol);
    assert_eq!(references.binding_path(base), ordinary.bindings);
    assert_eq!(references.owned_binding_elements(), 3);
    let alias2_symbol = probe.node(base).symbol.unwrap();
    let alias0 = (0..snapshot.nodes.len())
        .map(|at| super::NodeId(u32::try_from(at).unwrap()))
        .find(|at| {
            probe.kind_of(*at) == Some(super::syntax::VARIABLE_DECLARATION)
                && probe
                    .name_node(*at)
                    .and_then(|name| probe.node(name).text.as_ref())
                    .and_then(|text| text.as_utf8())
                    == Some("Alias0")
        })
        .unwrap();
    let initializer = super::declaration_initializer(
        &probe.children(alias0),
        probe.name_node(alias0).unwrap(),
        |at| probe.kind_of(at),
    )
    .unwrap();
    for missing in [false, true] {
        let mut changed = semantic.clone();
        changed.nodes[initializer.0 as usize].symbol = Some(if missing {
            super::SymbolId(u32::MAX)
        } else {
            alias2_symbol
        });
        let indexed = super::LoweringSnapshot::new(&changed);
        let changed_probe = super::FuncBuilder::probe(&indexed);
        let mut references = super::reference_index::References::new(&changed_probe);
        ALIAS_LINKS.with(|n| n.set(0));
        assert!(
            references.of(base).is_none(),
            "invalid alias path missing={missing}"
        );
        let first = ALIAS_LINKS.with(Cell::get);
        for _ in 0..256 {
            assert!(references.of(base).is_none());
        }
        assert_eq!(
            ALIAS_LINKS.with(Cell::get),
            first,
            "negative cache must reuse the same conservative answer"
        );
    }
    let mut changed = semantic.clone();
    changed.nodes[base.0 as usize].symbol = Some(super::SymbolId(u32::MAX));
    let indexed = super::LoweringSnapshot::new(&changed);
    let changed_probe = super::FuncBuilder::probe(&indexed);
    assert!(
        super::reference_index::References::new(&changed_probe)
            .of(base)
            .is_none()
    );
    std::fs::remove_dir_all(dir).unwrap();
}
