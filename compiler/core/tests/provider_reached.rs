//! Checked provider requirements, including erased/probe and pruned references.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir::features::{
    FeatureId, FeatureUse, ReachContext, ReachedFeatures, reached_features,
};
use nts_frontend_ts::Frontend;
use nts_semantic_schema::{Library, SemanticSnapshot, SymbolId};
use std::num::NonZeroU16;

struct Project(Utf8PathBuf);
impl Project {
    fn new(name: &str, source: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "nts-provider-reached-{}-{name}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let root = Utf8PathBuf::from_path_buf(root)
            .unwrap()
            .canonicalize_utf8()
            .unwrap();
        std::fs::write(root.join("main.ts"), source).unwrap();
        std::fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"ESNext","lib":["ESNext","DOM"],"types":[]},"files":["main.ts"]}"#).unwrap();
        Self(root)
    }
    fn capture(&self) -> SemanticSnapshot {
        capture(&self.0)
    }
}
impl Drop for Project {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn capture(root: &Utf8Path) -> SemanticSnapshot {
    let snapshot = Frontend::new(root)
        .with_checkers(NonZeroU16::MIN)
        .snapshot(&root.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    snapshot
}
fn roots(snapshot: &SemanticSnapshot, names: &[&str]) -> Vec<SymbolId> {
    names
        .iter()
        .map(|name| {
            snapshot
                .modules
                .iter()
                .flat_map(|m| &m.exports)
                .find_map(|(export, symbol)| (export == name).then_some(*symbol))
                .unwrap()
        })
        .collect()
}
fn reached(
    snapshot: &SemanticSnapshot,
    names: &[&str],
    available: impl Fn(&FeatureId) -> Option<bool>,
) -> ReachedFeatures {
    reached_features(
        snapshot,
        roots(snapshot, names),
        [],
        ReachContext {
            revision: nts_diagnostics::Digest([0; 16]),
            profile: nts_diagnostics::Digest([1; 16]),
        },
        available,
    )
    .unwrap()
}
fn runtime(result: &ReachedFeatures) -> Vec<&str> {
    result
        .features
        .iter()
        .filter(|f| f.requires_provider())
        .map(|f| f.feature.name.as_str())
        .collect()
}

#[test]
fn erased_annotations_and_type_queries_do_not_reach_a_helpers_body() {
    let snapshot = Project::new(
        "erased",
        r"
        function helper() { return new WeakRef({}); }
        export function subject(value: WeakMap<object, object>): number {
            type Query = typeof helper;
            type Builtin = typeof WeakMap;
            return 1;
        }
        export function calls(): object { return helper(); }
    ",
    )
    .capture();
    let only = reached(&snapshot, &["subject"], |_| None);
    assert!(runtime(&only).is_empty(), "{only:?}");
    let weakmap = only
        .features
        .iter()
        .find(|f| f.feature.name == "WeakMap")
        .unwrap();
    assert!(
        weakmap
            .witnesses
            .iter()
            .all(|w| w.use_kind == FeatureUse::TypeOnly)
    );
    let both = reached(&snapshot, &["subject", "calls"], |_| None);
    assert_eq!(runtime(&both), ["WeakRef"]);
    assert_eq!(both, reached(&snapshot, &["calls", "subject"], |_| None));
}

#[test]
fn typeof_probes_prune_before_requirements_and_unknown_guards_keep_both_arms() {
    let snapshot = Project::new(
        "typeof",
        r#"
        export function subject(flag: boolean): object {
            if (typeof WeakMap !== "undefined") return new WeakMap();
            return flag ? new Map() : new Set();
        }
        export function parenthesized(): object {
            return typeof ((WeakMap)) === "undefined" ? new Map() : new WeakRef({});
        }
        export function property(): object {
            return typeof globalThis.WeakMap === "undefined" ? new Map() : new WeakRef({});
        }
        export function branches(): object {
            return typeof WeakRef === "undefined" ? new Map() : new WeakRef({});
        }
        export function probe(): boolean { return typeof WeakMap === "undefined"; }
    "#,
    )
    .capture();
    let probe = reached(&snapshot, &["probe"], |_| Some(false));
    assert_eq!(runtime(&probe), [] as [&str; 0]);
    assert_eq!(probe.probes.len(), 1);
    for subject in ["parenthesized", "property"] {
        assert_eq!(
            runtime(&reached(&snapshot, &[subject], |_| Some(false))),
            ["Map"],
            "{subject}"
        );
    }
    assert_eq!(probe.features[0].witnesses[0].use_kind, FeatureUse::Probe);
    assert_eq!(
        runtime(&reached(&snapshot, &["branches"], |_| Some(false))),
        ["Map"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["branches"], |_| Some(true))),
        ["WeakRef"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["branches"], |_| None)),
        ["Map", "WeakRef"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["subject"], |_| Some(false))),
        ["Map", "Set"]
    );
}

#[test]
fn in_probes_authenticate_static_key_and_global_receiver() {
    let snapshot = Project::new(
        "in",
        r#"
        export function subject(): object {
            return "WeakMap" in globalThis ? new WeakRef({}) : new Map();
        }
        export function shadow(globalThis: object): object {
            return "WeakMap" in globalThis ? new WeakRef({}) : new Map();
        }
        export function dynamic(key: string): object {
            return key in globalThis ? new WeakRef({}) : new Map();
        }
        export function unresolved(): object {
            return "aGlobalNoLibraryDeclares" in globalThis ? new WeakRef({}) : new Map();
        }
    "#,
    )
    .capture();
    let actual = reached(&snapshot, &["subject"], |_| Some(false));
    assert_eq!(runtime(&actual), ["Map"]);
    assert_eq!(actual.probes.len(), 1);
    assert_eq!(actual.probes[0].feature.as_ref().unwrap().name, "WeakMap");
    assert_eq!(
        actual.probes[0].feature.as_ref().unwrap().library,
        Library::Es
    );
    for subject in ["shadow", "dynamic", "unresolved"] {
        assert_eq!(
            runtime(&reached(&snapshot, &[subject], |_| Some(false))),
            ["Map", "WeakRef"],
            "{subject}"
        );
    }
    // A missing captured identity must not acquire one from its key's spelling.
    let mut missing = snapshot.clone();
    for node in &mut missing.nodes {
        if node.text.as_ref().and_then(|s| s.as_utf8()) == Some("WeakMap")
            && node.kind
                == nts_semantic_schema::NodeKind::Syntax(
                    nts_semantic_schema::syntax::STRING_LITERAL,
                )
        {
            node.symbol = None;
        }
    }
    assert_eq!(
        runtime(&reached(&missing, &["subject"], |_| Some(false))),
        ["Map", "WeakRef"]
    );
}

#[test]
fn logical_guards_prune_short_circuit_uses_and_keep_unknown_requirements() {
    let snapshot = Project::new("logical", r#"
        export function subject(flag: boolean): object {
            if (!(typeof WeakMap === "undefined") && ("WeakRef" in globalThis)) return new WeakRef({});
            if (flag || typeof WeakMap !== "undefined") return new Set();
            return new Map();
        }
        export function short(): boolean {
            return typeof WeakMap !== "undefined" && new WeakRef({}) !== null;
        }
    "#).capture();
    assert_eq!(
        runtime(&reached(&snapshot, &["short"], |_| Some(false))),
        [] as [&str; 0]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["short"], |_| None)),
        ["WeakRef"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["subject"], |_| Some(false))),
        ["Map", "Set"]
    );
}

#[test]
fn executable_heritage_and_type_arguments_have_distinct_meanings() {
    let snapshot = Project::new(
        "heritage",
        r"
        export class Subject extends Map<string, WeakRef<object>> {}
        export class Contract implements Iterable<WeakRef<object>> {
            *[Symbol.iterator](): Iterator<WeakRef<object>> { }
        }
    ",
    )
    .capture();
    let actual = reached(&snapshot, &["Subject"], |_| None);
    assert_eq!(runtime(&actual), ["Map"]);
    let weakref = actual
        .features
        .iter()
        .find(|f| f.feature.name == "WeakRef")
        .unwrap();
    assert!(
        weakref
            .witnesses
            .iter()
            .all(|w| w.use_kind == FeatureUse::TypeOnly)
    );
    let contract = reached(&snapshot, &["Contract"], |_| None);
    assert_eq!(runtime(&contract), ["Symbol"]);
}

#[test]
fn recursive_declarations_and_aliases_are_finite_and_order_independent() {
    let snapshot = Project::new(
        "cycle",
        r"
        function first(flag: boolean): object { return flag ? second(false) : new Map(); }
        function second(flag: boolean): object { return flag ? first(false) : new Set(); }
        function unused(): object { return new WeakRef({}); }
        export { first as renamed, second };
    ",
    )
    .capture();
    let forward = reached(&snapshot, &["renamed", "second"], |_| None);
    assert_eq!(runtime(&forward), ["Map", "Set"]);
    assert_eq!(
        forward,
        reached(&snapshot, &["second", "renamed"], |_| None)
    );
}

#[test]
fn unused_nested_bodies_are_deferred_and_reopened_by_actual_demand() {
    let snapshot = Project::new(
        "deferred",
        r"
        export function unused(): number {
            function helper(): object { return new WeakMap(); }
            const closure = () => new WeakRef({});
            return 1;
        }
        export function called(): object {
            function helper(): object { return new WeakMap(); }
            return helper();
        }
        export function closure(): object {
            const helper = () => new WeakRef({});
            return helper();
        }
        export function effects(): number {
            const object = new Map();
            function helper(value = new WeakMap()): object { return value; }
            return 1;
        }
        export function definitions(): number {
            class Local { field = new WeakMap(); static field = new Map(); method() { return new WeakRef({}); } }
            return 1;
        }
        export function construction(): number {
            class Local { field = new WeakMap(); static field = new Map(); method() { return new WeakRef({}); } }
            new Local();
            return 1;
        }
        export const exported = () => new WeakMap();
    ",
    )
    .capture();
    let unused = reached(&snapshot, &["unused"], |_| None);
    assert!(runtime(&unused).is_empty(), "{unused:?}");
    assert_eq!(
        runtime(&reached(&snapshot, &["called"], |_| None)),
        ["WeakMap"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["closure"], |_| None)),
        ["WeakRef"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["effects"], |_| None)),
        ["Map"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["definitions"], |_| None)),
        ["Map"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["construction"], |_| None)),
        ["Map", "WeakMap"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["exported"], |_| None)),
        ["WeakMap"]
    );
}

#[test]
fn opaque_control_cannot_prove_that_a_loop_has_no_exit() {
    let snapshot = Project::new("opaque-control", r"
        export function direct(): object { while (true) { break; } return new WeakMap(); }
        export function wrapped(): object { while (true) { try { break; } finally {} } return new WeakMap(); }
        export function overridden(): object { while (true) { try { return new Map(); } finally { break; } } return new WeakMap(); }
    ").capture();
    for subject in ["direct", "wrapped"] {
        assert_eq!(
            runtime(&reached(&snapshot, &[subject], |_| None)),
            ["WeakMap"],
            "{subject}"
        );
    }
    assert!(runtime(&reached(&snapshot, &["overridden"], |_| None)).contains(&"WeakMap"));
}

#[test]
fn actual_statement_index_and_membership_work_grows_linearly() {
    let mut rows = Vec::new();
    for count in [32, 128, 512] {
        let source = format!(
            "export function subject(): number {{ let value = 0; {} return value; }}",
            "value += 1;".repeat(count)
        );
        let snapshot = Project::new(&format!("flat-{count}"), &source).capture();
        let result = reached(&snapshot, &["subject"], |_| None);
        let work = result.plan().work();
        println!("flat statements={count} actual work={work:?}");
        rows.push((count, work));
    }
    let (base, work) = rows[0];
    for (count, row) in rows {
        assert_eq!(
            row.statement_index_visits - count,
            work.statement_index_visits - base
        );
        assert_eq!(
            row.statement_membership_checks - count,
            work.statement_membership_checks - base
        );
        assert!(row.graph_edges <= count / base * work.graph_edges);
    }
}

#[test]
fn actual_probe_normalization_and_role_work_grows_linearly() {
    for property in [false, true] {
        let mut rows = Vec::new();
        for count in [8, 32, 128] {
            let operand = if property {
                format!("{}WeakMap", "globalThis.".repeat(count))
            } else {
                format!("{}WeakMap{}", "(".repeat(count), ")".repeat(count))
            };
            let source = format!(
                "export function subject(): object {{ return typeof {operand} === 'undefined' ? new Map() : new WeakRef({{}}); }}"
            );
            let snapshot = Project::new(&format!("probe-{property}-{count}"), &source).capture();
            let result = reached(&snapshot, &["subject"], |_| Some(false));
            assert_eq!(runtime(&result), ["Map"]);
            let work = result.plan().work();
            assert_eq!(work.normalization_visits, snapshot.nodes.len());
            println!("probe property={property} depth={count} actual work={work:?}");
            rows.push((count, work));
        }
        let (base, work) = rows[0];
        for (count, row) in rows {
            assert!(row.graph_edges <= count / base * work.graph_edges);
            assert!(row.probe_role_checks <= count / base * work.probe_role_checks);
            assert!(row.binding_cache_misses <= count / base * work.binding_cache_misses);
        }
    }
}

#[test]
fn actual_owner_and_alias_work_is_amortized_across_symbols_and_repeated_uses() {
    use nts_core::hir::features::{FeatureBindings, GlobalMeaning};
    use nts_semantic_schema::{PropertyKey, SymbolFlags};
    let snapshot = owner_snapshot("owner-chain");
    let member = snapshot
        .symbols
        .iter()
        .find(|symbol| {
            symbol.name == PropertyKey::Name("localeCompare".into())
                && symbol.library == Some(Library::Es)
        })
        .unwrap();
    let root = member.owner.unwrap();
    for count in [4, 16, 64] {
        // Raw chains retain checked leaf/owner provenance. No claim is made
        // that these synthetic intermediate namespaces were captured by tsrs.
        let mut symbols = snapshot.symbols.clone();
        let mut parent = root;
        let mut chain = Vec::new();
        for index in 0..count {
            let mut record = member.clone();
            record.name = PropertyKey::Name(format!("scope{index}"));
            record.owner = Some(parent);
            let symbol = SymbolId(u32::try_from(symbols.len()).unwrap());
            symbols.push(record);
            chain.push(symbol);
            parent = symbol;
        }
        let mut aliases = Vec::new();
        for _ in 0..count {
            let mut record = member.clone();
            record.aliased = Some(parent);
            record.owner = None;
            let symbol = SymbolId(u32::try_from(symbols.len()).unwrap());
            symbols.push(record);
            aliases.push(symbol);
            parent = symbol;
        }
        let mut bindings = FeatureBindings::new(&symbols);
        assert!(
            bindings
                .global(chain[0], GlobalMeaning::Value)
                .unwrap()
                .is_none()
        );
        for symbol in chain.iter().chain(&aliases) {
            assert_eq!(
                bindings
                    .get(*symbol, GlobalMeaning::Value)
                    .unwrap()
                    .unwrap()
                    .symbol(),
                root
            );
        }
        let work = bindings.work();
        assert!(work.owner_hops <= 2 * count);
        assert_eq!(work.alias_hops, count);
        for _ in 0..20 {
            for symbol in chain.iter().chain(&aliases) {
                assert!(
                    bindings
                        .get(*symbol, GlobalMeaning::Value)
                        .unwrap()
                        .is_some()
                );
            }
        }
        assert_eq!(bindings.work(), work);
        println!("owner chain={count} aliases={count} repeated=20 actual work={work:?}");
        let mut missing = symbols.clone();
        missing[root.0 as usize].flags.0 &= !SymbolFlags::GLOBAL_VALUE.0;
        let mut bindings = FeatureBindings::new(&missing);
        assert!(
            bindings
                .get(parent, GlobalMeaning::Value)
                .unwrap()
                .is_none()
        );
        let work = bindings.work();
        for _ in 0..20 {
            assert!(
                bindings
                    .get(parent, GlobalMeaning::Value)
                    .unwrap()
                    .is_none()
            );
        }
        assert_eq!(bindings.work(), work);
        let mut cyclic = symbols;
        cyclic[chain[0].0 as usize].owner = Some(chain[0]);
        let mut bindings = FeatureBindings::new(&cyclic);
        assert!(bindings.get(parent, GlobalMeaning::Value).is_err());
        let work = bindings.work();
        for _ in 0..20 {
            assert!(bindings.get(parent, GlobalMeaning::Value).is_err());
        }
        assert_eq!(bindings.work(), work);
    }
}

#[test]
fn folded_loop_edges_and_early_returns_use_the_same_completion_plan() {
    let snapshot = Project::new(
        "completion",
        r#"
        export function early(): object {
            if (typeof WeakMap !== "undefined") return new Map();
            return new WeakRef({});
        }
        export function whileGuard(): object {
            while (typeof WeakMap !== "undefined") { new WeakRef({}); break; }
            return new Map();
        }
        export function forGuard(): object {
            for (new Set(); typeof WeakMap !== "undefined"; new WeakRef({})) { new WeakMap(); }
            return new Map();
        }
        export function doGuard(): object {
            do { new WeakRef({}); } while (typeof WeakMap !== "undefined");
            return new Map();
        }
    "#,
    )
    .capture();
    assert_eq!(
        runtime(&reached(&snapshot, &["early"], |_| Some(true))),
        ["Map"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["early"], |_| Some(false))),
        ["WeakRef"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["early"], |_| None)),
        ["Map", "WeakRef"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["whileGuard"], |_| Some(false))),
        ["Map"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["forGuard"], |_| Some(false))),
        ["Map", "Set"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["doGuard"], |_| Some(false))),
        ["Map", "WeakRef"]
    );
    let result = reached(&snapshot, &["early"], |_| Some(true));
    let product_roots = roots(&snapshot, &["early"]);
    assert!(result.plan().validates(
        &snapshot,
        &product_roots,
        &[],
        ReachContext {
            revision: nts_diagnostics::Digest([0; 16]),
            profile: nts_diagnostics::Digest([1; 16])
        }
    ));
    assert!(!result.plan().validates(
        &snapshot,
        &product_roots,
        &[],
        ReachContext {
            revision: nts_diagnostics::Digest([1; 16]),
            profile: nts_diagnostics::Digest([1; 16])
        }
    ));
    assert!(!result.plan().validates(
        &snapshot,
        &product_roots,
        &[],
        ReachContext {
            revision: nts_diagnostics::Digest([0; 16]),
            profile: nts_diagnostics::Digest([2; 16])
        }
    ));
    assert!(!result.plan().validates(
        &snapshot,
        &roots(&snapshot, &["whileGuard"]),
        &[],
        ReachContext {
            revision: nts_diagnostics::Digest([0; 16]),
            profile: nts_diagnostics::Digest([1; 16])
        }
    ));
    let mut changed = snapshot.clone();
    changed.nodes[0].flags ^= 1;
    assert!(!result.plan().validates(
        &changed,
        &product_roots,
        &[],
        ReachContext {
            revision: nts_diagnostics::Digest([0; 16]),
            profile: nts_diagnostics::Digest([1; 16])
        }
    ));
}

#[test]
fn primitive_members_keep_their_checked_owner_and_source_decoys_do_not() {
    use nts_core::hir::features::{GlobalMeaning, feature_binding};
    use nts_semantic_schema::{PropertyKey, SymbolFlags};
    let snapshot = owner_snapshot("owners");
    let library = snapshot
        .symbols
        .iter()
        .enumerate()
        .find(|(_, symbol)| {
            symbol.name == PropertyKey::Name("localeCompare".into())
                && symbol.library == Some(Library::Es)
        })
        .unwrap();
    let member = SymbolId(u32::try_from(library.0).unwrap());
    let owner = library.1.owner.expect("actual member declaring owner");
    println!(
        "library member {member:?}: {:?}; owner {owner:?}: {:?}",
        library.1, snapshot.symbols[owner.0 as usize]
    );
    let owner_types: Vec<_> = snapshot
        .types
        .iter()
        .enumerate()
        .filter(|(_, ty)| ty.symbol == Some(owner))
        .collect();
    println!("captured declaring owner types: {owner_types:?}");
    let feature = feature_binding(&snapshot.symbols, member, GlobalMeaning::Value)
        .unwrap()
        .unwrap();
    assert_eq!(feature.name(), "String");
    assert_eq!(feature.library(), &Library::Es);
    assert!(feature.record().flags.contains(SymbolFlags::GLOBAL_VALUE));
    assert_eq!(
        runtime(&reached(&snapshot, &["subject"], |_| None)),
        ["String"]
    );
    assert_eq!(
        runtime(&reached(&snapshot, &["control"], |_| None)),
        [] as [&str; 0]
    );
    let own = snapshot
        .symbols
        .iter()
        .enumerate()
        .find(|(_, symbol)| {
            symbol.name == PropertyKey::Name("localeCompare".into()) && symbol.library.is_none()
        })
        .unwrap();
    assert!(
        feature_binding(
            &snapshot.symbols,
            SymbolId(u32::try_from(own.0).unwrap()),
            GlobalMeaning::Value
        )
        .unwrap()
        .is_none()
    );
    let mut missing = snapshot.clone();
    missing.symbols[owner.0 as usize].flags.0 &= !SymbolFlags::GLOBAL_VALUE.0;
    missing.symbols[owner.0 as usize].constructor_value = None;
    assert!(
        feature_binding(&missing.symbols, member, GlobalMeaning::Value)
            .unwrap()
            .is_none()
    );
    let mut cyclic = snapshot.clone();
    cyclic.symbols[member.0 as usize].owner = Some(member);
    assert!(cyclic.validate().is_err());
    assert!(feature_binding(&cyclic.symbols, member, GlobalMeaning::Value).is_err());
    cyclic.symbols[member.0 as usize].owner = Some(SymbolId(u32::MAX));
    assert!(cyclic.validate().is_err());
}

fn owner_snapshot(name: &str) -> SemanticSnapshot {
    Project::new(
        name,
        r#"
        class Source { localeCompare(value: string): number { return 1; } }
        interface PretendConstructor { readonly prototype: Number; isNaN(value: number): boolean; }
        namespace Decoy {
            export interface Number { own: string; }
            export interface Constructor { readonly prototype: Number; isNaN(value: number): boolean; }
        }
        export function subject(): number { return "a".localeCompare("b"); }
        export function control(): number { return new Source().localeCompare("b"); }
        export function constructor(): boolean { return Number.isNaN(1); }
        export function typeOnly(value: PretendConstructor): void { }
        declare namespace Local { interface PretendValue { own: string; } }
        declare global {
            interface GlobalConstructor { readonly prototype: Local.PretendValue; }
            var PretendValue: GlobalConstructor;
        }
        export function globalDecoy(value: GlobalConstructor): void { }
        export function decoy(value: Decoy.Constructor): void { }
    "#,
    )
    .capture()
}

#[test]
fn constructor_interfaces_require_the_actual_global_value_and_type_identity() {
    use nts_core::hir::features::{GlobalMeaning, feature_binding};
    use nts_semantic_schema::{PropertyKey, SymbolFlags};
    let snapshot = owner_snapshot("constructor-owners");
    let static_member = snapshot
        .symbols
        .iter()
        .enumerate()
        .find(|(_, symbol)| {
            symbol.name == PropertyKey::Name("isNaN".into()) && symbol.library == Some(Library::Es)
        })
        .unwrap();
    let static_id = SymbolId(u32::try_from(static_member.0).unwrap());
    let static_owner = &snapshot.symbols[static_member.1.owner.unwrap().0 as usize];
    assert!(static_owner.constructor_value.is_some(), "{static_owner:?}");
    assert_eq!(
        feature_binding(&snapshot.symbols, static_id, GlobalMeaning::Value)
            .unwrap()
            .unwrap()
            .name(),
        "Number"
    );
    let pretend = snapshot
        .symbols
        .iter()
        .find(|symbol| symbol.name == PropertyKey::Name("PretendConstructor".into()))
        .unwrap();
    assert!(pretend.constructor_value.is_none());
    let namespace_owner = snapshot
        .symbols
        .iter()
        .find(|symbol| symbol.name == PropertyKey::Name("Constructor".into()))
        .unwrap();
    assert!(namespace_owner.constructor_value.is_none());
    let global_decoy = snapshot
        .symbols
        .iter()
        .find(|symbol| symbol.name == PropertyKey::Name("GlobalConstructor".into()))
        .unwrap();
    assert!(global_decoy.flags.contains(SymbolFlags::GLOBAL_TYPE));
    assert!(!global_decoy.flags.contains(SymbolFlags::GLOBAL_VALUE));
    assert!(
        global_decoy.constructor_value.is_none(),
        "same-named prototype type is not the global value identity"
    );
}

#[test]
fn the_complete_51_probe_population_and_controls_use_the_same_checked_walk() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/refusals")
        .canonicalize_utf8()
        .unwrap();
    let mut projects: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("builtin-study-")
        })
        .collect();
    projects.sort();
    assert_eq!(projects.len(), 51);
    for project in projects {
        let path = Utf8Path::from_path(&project).unwrap();
        let snapshot = capture(path);
        let mut names: Vec<_> = snapshot
            .modules
            .iter()
            .flat_map(|module| &module.exports)
            .map(|(name, _)| name.as_str())
            .filter(|name| name.starts_with("subject") || name.starts_with("control"))
            .collect();
        names.sort_unstable();
        assert!(
            names.iter().any(|name| name.starts_with("subject")),
            "{path}"
        );
        assert!(
            names.iter().any(|name| name.starts_with("control")),
            "{path}"
        );
        for name in names {
            let result = reached(&snapshot, &[name], |_| None);
            assert_eq!(
                result,
                reached(&snapshot, &[name], |_| Some(true)),
                "{} {name}: no profile guards in archived probes",
                path.file_name().unwrap()
            );
            for feature in &result.features {
                assert_ne!(feature.witnesses, Vec::new());
                for witness in &feature.witnesses {
                    assert!(snapshot.nodes[witness.node.0 as usize].symbol.is_some());
                    assert_eq!(
                        witness.location,
                        snapshot.nodes[witness.node.0 as usize].origin.location
                    );
                }
            }
            println!(
                "{}\t{name}\t{:?}",
                path.file_name().unwrap(),
                runtime(&result)
            );
        }
    }
}
