//! Migration facts must be deterministic, conservative and observational.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{
    self, Memory,
    memory::{Analysis, ContextArrival, Home, LegacyVariant, Limits, Reason, Report},
};
use nts_frontend_ts::Frontend;

fn snapshot(case: &str) -> nts_semantic_schema::SemanticSnapshot {
    snapshot_at(&format!("tests/memory/{case}"))
}

fn snapshot_at(case: &str) -> nts_semantic_schema::SemanticSnapshot {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../{case}/tsconfig.json"))
        .canonicalize_utf8()
        .expect("the control is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the control captures");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    snapshot
}

fn assert_actual_arrival(
    program: &hir::Program,
    report: &Report,
    entry: &str,
    callee: &str,
    home: &str,
) -> (ContextArrival, String) {
    let context = report
        .context_views()
        .find(|context| context.root && context.function == entry)
        .expect("actual entry entry context");
    let arrivals = report
        .context_arrivals()
        .filter(|arrival| {
            arrival.parent == context.id
                && report
                    .context(arrival.child)
                    .is_some_and(|child| child.function == callee)
        })
        .collect::<Vec<_>>();
    assert_eq!(arrivals.len(), 1, "one actual {entry} -> {callee} arrival");
    let arrival = arrivals[0];
    let entry_body = program
        .funcs
        .iter()
        .find(|function| function.name == entry)
        .expect("actual surviving entry body");
    let hir::OpKind::Call {
        callee: hir::Callee::Direct(target),
        ..
    } = &entry_body.value(arrival.operation).kind
    else {
        panic!("the actual stable call operation must name its physical target");
    };
    if home == "call-region" {
        assert!(
            report
                .legacy_clones
                .iter()
                .any(|(variant, original)| variant == target && original == callee)
        );
    } else {
        assert_eq!(target, callee, "the retained entry keeps the original body");
    }
    let sites = report
        .sites
        .iter()
        .filter(|site| site.context_id == arrival.child && site.id.function == callee)
        .collect::<Vec<_>>();
    assert_eq!(sites.len(), 1, "the actual arriving allocation context");
    assert_eq!(sites[0].legacy, [home]);
    assert_eq!(
        sites[0].legacy_variants,
        [LegacyVariant {
            function: target.clone(),
            home: home.to_owned()
        }]
    );
    assert!(sites[0].legacy_unknown.is_none());
    (arrival, target.clone())
}

#[test]
fn legacy_homes_belong_to_the_actual_caller_context() {
    let snapshot = snapshot_at("tests/programs/calls-a-region-could-serve");
    let names = ["readsAList".to_owned(), "keepsAList".to_owned()];
    let options = hir::Options {
        provider: Memory::ReferenceCounting,
        roots: hir::reachable::Roots::Declared(&names),
        ..hir::Options::new(
            nts_core::hir::backend::Backend::C,
            nts_core::hir::EntryUnwind::Terminal,
        )
    };
    let mut prepared = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
        .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
    prepared
        .check()
        .expect("the actual legacy program verifies");
    let mut report = prepared.memory.take().expect("requested comparison");
    assert!(report.failure.is_none(), "{:?}", report.failure);
    let sites = report
        .sites
        .iter()
        .filter(|site| site.id.function == "build")
        .collect::<Vec<_>>();
    assert_eq!(
        sites.len(),
        2,
        "one allocation in each actual caller context"
    );
    for site in &sites {
        assert_eq!(
            site.legacy.len(),
            1,
            "another caller's clone/home contaminated this context: {site:?}"
        );
    }
    let homes = sites
        .iter()
        .flat_map(|site| site.legacy.iter().map(String::as_str))
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(homes, ["call-region", "heap"].into_iter().collect());
    assert_actual_arrival(
        &prepared.program,
        &report,
        "readsAList",
        "build",
        "call-region",
    );
    assert_actual_arrival(&prepared.program, &report, "keepsAList", "build", "heap");
    // Swapping the callers used to satisfy the aggregate above. Prove that the
    // producer-owned arrival/actual-callee assertions reject that bad answer.
    let original = report
        .sites
        .iter()
        .filter(|site| site.id.function == "build")
        .map(|site| (site.legacy.clone(), site.legacy_variants.clone()))
        .collect::<Vec<_>>();
    for (site, (homes, variants)) in report
        .sites
        .iter_mut()
        .filter(|site| site.id.function == "build")
        .zip(original.into_iter().rev())
    {
        site.legacy = homes;
        site.legacy_variants = variants;
    }
    assert!(
        std::panic::catch_unwind(|| assert_actual_arrival(
            &prepared.program,
            &report,
            "readsAList",
            "build",
            "call-region"
        ))
        .is_err()
    );
}

#[test]
fn actual_recursive_region_arrivals_keep_their_physical_body() {
    let snapshot = snapshot_at("tests/programs/calls-a-region-could-serve");
    let names = ["readsARecursiveList".to_owned()];
    let options = hir::Options {
        provider: Memory::ReferenceCounting,
        roots: hir::reachable::Roots::Declared(&names),
        ..hir::Options::new(
            nts_core::hir::backend::Backend::C,
            nts_core::hir::EntryUnwind::Terminal,
        )
    };
    let prepared = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
        .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
    prepared
        .check()
        .expect("the actual recursive region program verifies");
    let report = prepared.memory.as_ref().expect("requested comparison");
    assert!(report.failure.is_none());
    let (entry, target) = assert_actual_arrival(
        &prepared.program,
        report,
        "readsARecursiveList",
        "buildDown",
        "call-region",
    );
    let recursive = report
        .context_arrivals()
        .filter(|arrival| arrival.parent == entry.child && arrival.child == entry.child)
        .collect::<Vec<_>>();
    assert_eq!(
        recursive.len(),
        1,
        "the actual recursive arrival is retained"
    );
    let body = prepared
        .program
        .funcs
        .iter()
        .find(|function| function.name == target)
        .expect("actual recursive physical body");
    assert!(
        matches!(&body.value(recursive[0].operation).kind, hir::OpKind::Call { callee: hir::Callee::Direct(next), .. } if next == &target)
    );
}

#[test]
fn three_preparations_have_byte_identical_reports_and_hir() {
    for case in ["traversal", "shared-tail"] {
        let snapshot = snapshot(case);
        let options = hir::Options {
            provider: Memory::ReferenceCounting,
            ..hir::Options::new(
                nts_core::hir::backend::Backend::C,
                nts_core::hir::EntryUnwind::Terminal,
            )
        };
        let normal = hir::prepare_unverified(&snapshot, &options);
        assert!(
            normal.memory.is_none(),
            "normal preparation requests no report"
        );
        let prepare = || {
            hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
                .into_unverified_with_memory(&hir::PreparationOptions::from(&options))
        };
        let baseline = prepare();
        assert_eq!(
            format!("{:?}", normal.program),
            format!("{:?}", baseline.program)
        );
        let memory = baseline
            .memory
            .as_ref()
            .expect("diagnostics were requested");
        assert!(!memory.sites.is_empty(), "{case} must exercise allocation");
        assert!(memory.failure.is_none(), "{case}: {:?}", memory.failure);
        assert!(
            memory.sites.iter().all(|site| !site.legacy.is_empty()),
            "every source allocation must map to its emitted original or region clone"
        );
        for _ in 0..2 {
            let repeated = prepare();
            assert_eq!(
                memory.render(),
                repeated.memory.as_ref().expect("requested report").render(),
                "{case}"
            );
            assert_eq!(
                format!("{:?}", baseline.program),
                format!("{:?}", repeated.program),
                "{case}"
            );
        }
        let before = format!("{:?}", baseline.program);
        let observed = Analysis::of(&baseline.program);
        assert!(std::ptr::eq(
            observed.program(),
            &raw const baseline.program
        ));
        drop(observed);
        assert_eq!(
            before,
            format!("{:?}", baseline.program),
            "analysis changes no operation"
        );
    }
}

#[test]
fn exhausted_budget_has_no_partial_alias_payload_effect_or_home_permission() {
    let prepared = hir::prepare_unverified(
        &snapshot("shared-tail"),
        &hir::Options {
            provider: Memory::NoGc,
            ..hir::Options::new(
                nts_core::hir::backend::Backend::C,
                nts_core::hir::EntryUnwind::Terminal,
            )
        },
    );
    let report = Analysis::with_limits(
        &prepared.program,
        Limits {
            work_per_operation: 0,
            ..Limits::default()
        },
    )
    .into_report();
    assert!(
        !report.sites.is_empty(),
        "exhaustion must still inventory candidates"
    );
    assert_eq!(report.failure, Some(Reason::WorkBudget));
    assert!(
        report
            .sites
            .iter()
            .all(|site| site.home == Home::Heap(Reason::WorkBudget))
    );
    assert!(
        report
            .values
            .iter()
            .all(|value| value.aliases == ["unknown:budget"])
    );
    assert!(
        report
            .functions
            .iter()
            .all(|function| function.unknown_effects
                && function.may_change_length
                && function.may_suspend
                && function.may_reenter)
    );
}

#[test]
fn host_gc_never_publishes_native_placement_facts() {
    let snapshot = snapshot("no-escape");
    let options = hir::Options {
        provider: Memory::HostGc,
        ..hir::Options::new(
            nts_core::hir::backend::Backend::C,
            nts_core::hir::EntryUnwind::Terminal,
        )
    };
    let prepared = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
        .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
    assert!(prepared.memory.is_none());
}

#[test]
fn census_is_the_requested_graphs_sites_and_does_not_change_prepared_hir() {
    let snapshot = snapshot("traversal");
    let options = hir::Options {
        provider: Memory::ReferenceCounting,
        ..hir::Options::new(
            nts_core::hir::backend::Backend::C,
            nts_core::hir::EntryUnwind::Terminal,
        )
    };
    let normal = hir::prepare_unverified(&snapshot, &options);
    let observed = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
        .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
    let report = observed.memory.as_ref().unwrap();
    let before = format!("{:?}", observed.program);
    let census = report.census();
    assert!(!census.sites.is_empty());
    assert_eq!(
        census
            .sites
            .iter()
            .map(|site| site.contexts.len())
            .sum::<usize>(),
        report.sites.len()
    );
    for site in &census.sites {
        for context in &site.contexts {
            let original = report
                .sites
                .iter()
                .find(|row| {
                    row.id.function == site.id.function
                        && row.id.value == site.id.value
                        && row.context_id.0 == context.id
                })
                .unwrap();
            assert_eq!(site.origin.location.file, original.origin.location.file.0);
            assert_eq!(
                site.origin.location.start,
                original.origin.location.span.start
            );
            assert_eq!(context.retention_frontier, original.retention_frontier);
        }
    }
    assert_eq!(
        serde_json::to_string(&census).unwrap(),
        serde_json::to_string(&report.census()).unwrap()
    );
    assert_eq!(before, format!("{:?}", normal.program));
    assert_eq!(before, format!("{:?}", observed.program));
    assert!(
        Analysis::of(&hir::Program::default())
            .report()
            .census()
            .sites
            .is_empty()
    );
}

/// A benchmark case as `nts-bench` builds it: an executable rooted at `work`
/// and its module's evaluation, prepared for C under reference counting. A
/// case has no tsconfig of its own, so one is written beside the test's
/// output.
fn benchmark(case: &str) -> (hir::Prepared, hir::Prepared) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .expect("the repository");
    let out = crate::scratch::ScratchDir::path_in_target(&format!("nts-memory-{case}"));
    std::fs::create_dir_all(&*out).expect("scratch");
    let tsconfig = out.join("tsconfig.json");
    std::fs::write(
        &tsconfig,
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","include":["{root}/benchmarks/cases/{case}/"]}}"#
        ),
    )
    .expect("written config");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("the case captures");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    prepare_for_bench(&snapshot)
}

fn prepare_for_bench(
    snapshot: &nts_semantic_schema::SemanticSnapshot,
) -> (hir::Prepared, hir::Prepared) {
    let roots = ["work".to_owned(), hir::lower::MODULE_INIT.to_owned()];
    let options = hir::Options {
        provider: Memory::ReferenceCounting,
        roots: hir::reachable::Roots::Entry(&roots),
        ..hir::Options::new(
            nts_core::hir::backend::Backend::C,
            nts_core::hir::EntryUnwind::Terminal,
        )
    };
    let normal = hir::prepare_unverified(snapshot, &options);
    let observed = hir::RawProgram::lower(snapshot, options.entry_files, options.foreign)
        .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
    (normal, observed)
}

fn json_parse() -> (hir::Prepared, hir::Prepared) {
    benchmark("json-parse")
}

/// json-parse's allocation sites by the role they play in the parser. The
/// names are this workload's; the compiler publishes only the facts below.
///
/// - `scratch`: dies inside one parse and is not part of its result.
/// - `frame`: a parser frame, kept in the frame stack and reopened per depth.
/// - `result`: part of the value the parse returns.
/// - `keys`: a key list, which a later sibling's frame may take as its template.
/// - `growth`: backing storage grown by a push, a slice or an append.
/// - `raised`: the error path's objects and messages.
/// - `module`: module constants, held by module slots for the whole run.
/// - `driver`: the benchmark's own input, built once at module evaluation.
const JSON_PARSE_SITES: &[(&str, u32, &str, &str)] = &[
    ("Frame#addKey", 11, "CallResult", "keys"),
    ("Frame#addKey", 11, "CallStorage", "growth"),
    ("Frame#addKey", 17, "CallStorage", "growth"),
    ("Frame#finishedKeys", 11, "CallResult", "keys"),
    ("Frame#finishedKeys", 11, "CallStorage", "growth"),
    ("Frame#open", 7, "Array", "result"),
    ("Frame#open", 13, "Array", "result"),
    ("JsonValue.arrayValue", 3, "Object", "result"),
    ("JsonValue.booleanValue", 3, "Object", "result"),
    ("JsonValue.nullValue", 2, "Object", "result"),
    ("JsonValue.numberValue", 3, "Object", "result"),
    ("JsonValue.objectValue", 5, "Object", "result"),
    ("JsonValue.objectValue", 13, "Array", "scratch"),
    ("JsonValue.objectValue", 15, "Array", "scratch"),
    ("JsonValue.objectValue", 17, "Array", "scratch"),
    ("JsonValue.objectValue", 19, "Array", "scratch"),
    ("JsonValue.objectValue", 21, "Array", "scratch"),
    ("JsonValue.objectValue", 67, "CallResult", "scratch"),
    ("JsonValue.objectValue", 67, "CallStorage", "growth"),
    ("JsonValue.objectValue", 68, "CallStorage", "growth"),
    ("JsonValue.objectValue", 69, "CallStorage", "growth"),
    ("JsonValue.objectValue", 70, "CallStorage", "growth"),
    ("JsonValue.objectValue", 104, "CallResult", "scratch"),
    ("JsonValue.objectValue", 104, "CallStorage", "growth"),
    ("JsonValue.objectValue", 105, "CallStorage", "growth"),
    ("JsonValue.objectValue", 106, "CallStorage", "growth"),
    ("JsonValue.objectValue", 119, "Object", "result"),
    ("JsonValue.objectValue", 128, "Array", "keys"),
    ("JsonValue.objectValue", 130, "Array", "result"),
    ("JsonValue.objectValue", 139, "CallStorage", "growth"),
    ("JsonValue.objectValue", 141, "CallStorage", "growth"),
    ("JsonValue.objectValue", 151, "CallStorage", "growth"),
    ("JsonValue.objectValue", 153, "CallStorage", "growth"),
    ("JsonValue.objectValue", 156, "Object", "result"),
    ("JsonValue.plainObjectValue", 4, "Object", "result"),
    ("JsonValue.stringValue", 3, "Object", "result"),
    ("Scanner#describe#into", 8, "CallResult", "raised"),
    ("Scanner#describe#into", 8, "CallStorage", "raised"),
    ("Scanner#describe#into", 11, "String", "raised"),
    ("Scanner#describe#into", 14, "String", "raised"),
    ("Scanner#describe#into", 15, "String", "raised"),
    ("Scanner#readString", 25, "CallResult", "result"),
    ("Scanner#readString", 50, "CallResult", "result"),
    ("Scanner#readString", 75, "CallResult", "result"),
    ("Scanner#readString", 75, "CallStorage", "growth"),
    ("Scanner#readString", 96, "String", "result"),
    ("Scanner#readString", 100, "String", "result"),
    ("Scanner#readString", 104, "String", "result"),
    ("Scanner#readString", 108, "String", "result"),
    ("Scanner#readString", 112, "String", "result"),
    ("Scanner#readString", 116, "String", "result"),
    ("Scanner#readString", 120, "String", "result"),
    ("Scanner#readString", 124, "String", "result"),
    ("Scanner#readString", 167, "CallResult", "result"),
    ("Scanner#readString", 167, "CallStorage", "growth"),
    ("SyntaxError@toString", 9, "String", "raised"),
    ("SyntaxError@toString", 10, "String", "raised"),
    ("ascendingByIndex", 3, "Array", "scratch"),
    ("ascendingByIndex", 9, "CallStorage", "growth"),
    ("ascendingByIndex", 15, "Array", "scratch"),
    ("ascendingByIndex", 22, "CallStorage", "growth"),
    ("buildSeen", 2, "CallResult", "scratch"),
    ("buildSeen", 13, "CallResult", "scratch"),
    ("buildSeen", 13, "CallStorage", "growth"),
    ("module#init", 1, "Array", "module"),
    ("module#init", 4, "Array", "module"),
    ("module#init", 7, "Array", "module"),
    ("module#init", 10, "Array", "module"),
    ("module#init", 13, "Array", "module"),
    ("module#init", 16, "Array", "module"),
    ("numberValueOf", 34, "CallResult", "scratch"),
    ("openFrame", 9, "Object", "frame"),
    ("openFrame", 32, "CallStorage", "growth"),
    ("parseJsonText", 1, "Object", "scratch"),
    ("readValue", 2, "Array", "scratch"),
    ("readValue", 90, "CallStorage", "growth"),
    ("readValue", 93, "CallStorage", "growth"),
    ("source", 1, "Array", "driver"),
    ("source", 14, "CallResult", "driver"),
    ("source", 14, "CallStorage", "driver"),
    ("source", 17, "String", "driver"),
    ("source", 20, "CallResult", "driver"),
    ("source", 20, "CallStorage", "driver"),
    ("source", 23, "String", "driver"),
    ("source", 24, "String", "driver"),
    ("source", 26, "String", "driver"),
    ("source", 34, "String", "driver"),
    ("source", 36, "String", "driver"),
    ("source", 42, "CallResult", "driver"),
    ("source", 44, "String", "driver"),
    ("source", 46, "String", "driver"),
    ("source", 47, "CallStorage", "driver"),
    ("source", 52, "CallResult", "driver"),
    ("source", 53, "String", "driver"),
    ("source", 55, "String", "driver"),
    ("syntaxError", 2, "Object", "raised"),
    ("syntaxError", 4, "String", "raised"),
    ("syntaxError", 5, "CallResult", "raised"),
    ("syntaxError", 5, "CallStorage", "raised"),
];

/// A frontier relative to the site's own context and, where the workload has
/// one, the activation named by `anchor` that holds it (json-parse's parse),
/// so the `work` and `work#whole` arrivals read alike. An interval is folded
/// by the frame of the caller it is held in.
fn relative(frontier: &str, own: &str, anchor: Option<&str>) -> String {
    if let Some(label) = frontier.strip_prefix("interval ") {
        let caller = label.rsplit_once(":%").map_or(label, |(caller, _)| caller);
        return format!(
            "interval in {}",
            relative(&format!("frame {caller}"), own, anchor)
        );
    }
    let Some(frame) = frontier.strip_prefix("frame ") else {
        let reason = frontier.trim_start_matches("unknown frontier: ");
        let kind = reason.split(['(', '"']).next().unwrap_or(reason);
        let label = reason
            .split('"')
            .nth(1)
            .map(|label| {
                label
                    .split(" at ")
                    .next()
                    .unwrap_or(label)
                    .split(':')
                    .next()
                    .unwrap_or(label)
                    .to_owned()
            })
            .unwrap_or_default();
        return format!("outside {kind} {label}").trim_end().to_owned();
    };
    let parse = anchor.and_then(|anchor| {
        own.find(anchor).map(|at| {
            own[at + 1..]
                .find('/')
                .map_or(own, |next| &own[..at + 1 + next])
        })
    });
    let caller = parse
        .and_then(|parse| parse.rsplit_once('/'))
        .map(|(caller, _)| caller);
    if frame == own {
        "own".to_owned()
    } else if parse.is_some_and(|parse| frame == parse) {
        "parse".to_owned()
    } else if caller == Some(frame) {
        "caller of the parse".to_owned()
    } else if parse.is_some_and(|parse| frame.starts_with(&format!("{parse}/"))) {
        format!(
            "inside the parse: {}",
            frame.rsplit('/').next().unwrap_or(frame)
        )
    } else if anchor.is_none() && own.rsplit_once('/').is_some_and(|(up, _)| up == frame) {
        "caller".to_owned()
    } else if frame.ends_with(":merged") {
        format!("merged {frame}")
    } else {
        format!("frame {}", frame.rsplit('/').next().unwrap_or(frame))
    }
}

/// A site's holders, with a weak class member's taken from its class (the
/// report publishes those once), each marked whether it came from the class.
fn expanded_holders<'r>(
    report: &'r Report,
    site: &'r hir::memory::Site,
) -> Vec<(&'r hir::memory::Hold, bool)> {
    site.holders
        .iter()
        .flat_map(|hold| match &hold.holder {
            hir::memory::Holder::Class(label) => report
                .class_holders
                .iter()
                .filter(|(class, _)| class == label)
                .flat_map(|(_, holds)| holds.iter().map(|hold| (hold, true)))
                .collect::<Vec<_>>(),
            _ => vec![(hold, false)],
        })
        .collect()
}

fn holder_name(holder: &hir::memory::Holder) -> String {
    match holder {
        hir::memory::Holder::Site { id, .. } => {
            format!("{}%{}:{:?}", id.function, id.value, id.storage)
        }
        hir::memory::Holder::Class(_) => "weak-class".to_owned(),
        hir::memory::Holder::External(label) => {
            if label == "immortal" || label.starts_with("outside:") {
                label.clone()
            } else {
                "external".to_owned()
            }
        }
    }
}

/// Where a site's proof chain starts, with context keys folded.
fn root_text(site: &hir::memory::Site, anchor: Option<&str>) -> String {
    match &site.reached.root {
        hir::memory::Root::Scope(holder) => format!("scope of {}", holder_name(holder)),
        hir::memory::Root::Returned { context } => {
            format!(
                "returned to {}",
                relative(&format!("frame {context}"), &site.context, anchor)
            )
        }
        hir::memory::Root::Outside(label) => {
            format!(
                "outside {}",
                label
                    .split(" at ")
                    .next()
                    .unwrap_or(label)
                    .split(':')
                    .next()
                    .unwrap_or(label)
            )
        }
        hir::memory::Root::Unknown(reason) => format!("unknown {reason:?}"),
        hir::memory::Root::Joined(_) => "weak-class join".to_owned(),
    }
}

/// One line per source site: its role, and every distinct published answer
/// across its contexts, with context keys folded by `relative`.
fn site_table(report: &Report, sites: &[(&str, u32, &str, &str)], anchor: Option<&str>) -> String {
    use std::collections::{BTreeMap, BTreeSet};
    let roles: BTreeMap<_, _> = sites
        .iter()
        .map(|(function, value, storage, role)| ((*function, *value, *storage), *role))
        .collect();
    let mut rows: BTreeMap<(String, u32, String), (u32, BTreeSet<String>)> = BTreeMap::new();
    for site in &report.sites {
        let storage = format!("{:?}", site.id.storage);
        let role = roles
            .get(&(site.id.function.as_str(), site.id.value, storage.as_str()))
            .unwrap_or_else(|| panic!("unmapped site {:?}", site.id));
        let home = match &site.home {
            Home::Heap(reason) => format!(
                "heap {}",
                format!("{reason:?}").split('(').next().unwrap_or("")
            ),
            other => format!("{other:?}"),
        };
        let edge = match &site.reached.edge {
            hir::memory::Edge::Stored(hold) => {
                format!("stored in {} of {}", hold.slot, holder_name(&hold.holder))
            }
            other => format!("{other:?}").to_lowercase(),
        };
        let root = root_text(site, anchor);
        let holders: BTreeSet<_> = expanded_holders(report, site)
            .into_iter()
            .map(|(hold, class)| {
                format!(
                    "{} of {}{}",
                    hold.slot,
                    holder_name(&hold.holder),
                    if class { " (class)" } else { "" }
                )
            })
            .collect();
        let multiplicity = match &site.multiplicity {
            hir::memory::Multiplicity::One { .. } => "one",
            hir::memory::Multiplicity::Bounded { .. } => "bounded",
            hir::memory::Multiplicity::Unbounded { .. } => "unbounded",
        };
        let obligations: BTreeSet<_> = site
            .obligations
            .iter()
            .map(|reason| {
                format!("{reason:?}")
                    .split('(')
                    .next()
                    .unwrap_or("")
                    .to_owned()
            })
            .collect();
        let answer = format!(
            "{home}; frontier {}; {multiplicity}; {edge}; {root}; holders {holders:?}; obligations {obligations:?}; legacy {:?} {}",
            relative(&site.retention_frontier, &site.context, anchor),
            site.legacy,
            match site.legacy_agreement() {
                hir::memory::LegacyAgreement::Conservative(reason) => format!(
                    "conservative {}",
                    format!("{reason:?}").split('(').next().unwrap_or("")
                ),
                other => format!("{other:?}").to_lowercase(),
            },
        );
        let row = rows
            .entry((site.id.function.clone(), site.id.value, storage.clone()))
            .or_insert_with(|| (site.origin.location.span.start, BTreeSet::new()));
        row.1.insert(format!("{role}\t{answer}"));
    }
    let mut out = String::new();
    for ((function, value, storage), (start, answers)) in rows {
        for answer in answers {
            let (role, answer) = answer.split_once('\t').unwrap();
            let _ = std::fmt::Write::write_fmt(
                &mut out,
                format_args!("{role}\t{function}\t%{value}\t{storage}\t@{start}\t{answer}\n"),
            );
        }
    }
    out
}

/// Every json-parse site has a home and a proof, or a named failure: each
/// maps to an emitted variant, plays one named role, and publishes the same
/// answer three times. Normal preparation runs no solver and the observed
/// preparation is the same program.
#[test]
fn json_parse_sites_each_have_a_home_and_a_proof_or_a_named_failure() {
    let (normal, baseline) = json_parse();
    assert!(normal.memory.is_none());
    assert_eq!(
        format!("{:?}", normal.program),
        format!("{:?}", baseline.program),
        "the memory report changes no prepared operation"
    );
    let report = baseline.memory.as_ref().expect("requested report");
    assert!(report.failure.is_none(), "{:?}", report.failure);
    let mut seen = std::collections::BTreeSet::new();
    for site in &report.sites {
        assert!(
            !site.legacy.is_empty() && site.legacy_unknown.is_none(),
            "unmapped: {site:?}"
        );
        assert!(
            !matches!(
                site.legacy_agreement(),
                hir::memory::LegacyAgreement::Unmapped(_)
            ),
            "{site:?}"
        );
        match &site.home {
            Home::Heap(reason) => assert_eq!(site.obligations.first(), Some(reason), "{site:?}"),
            _ => assert!(site.obligations.is_empty(), "{site:?}"),
        }
        seen.insert((
            site.id.function.clone(),
            site.id.value,
            format!("{:?}", site.id.storage),
        ));
    }
    let table: std::collections::BTreeSet<_> = JSON_PARSE_SITES
        .iter()
        .map(|(function, value, storage, _)| {
            ((*function).to_owned(), *value, (*storage).to_owned())
        })
        .collect();
    assert_eq!(seen, table, "every source site has exactly one role");
    let rendered = site_table(report, JSON_PARSE_SITES, Some("/parseJsonText:"));
    print!("{rendered}");
    assert_eq!(
        rendered,
        include_str!("memory_json_parse.tsv"),
        "json-parse's published answers moved"
    );

    assert_role_proofs(report);

    let repeated = || {
        let prepared = json_parse().1;
        prepared.memory.expect("requested").render()
    };
    let first = report.render();
    for _ in 0..2 {
        assert_eq!(first, repeated(), "three byte-identical reports");
    }
}

/// The proofs each role owes, beside the table.
fn assert_role_proofs(report: &Report) {
    let contexts = |function: &'static str, value: u32| {
        report
            .sites
            .iter()
            .filter(move |site| site.id.function == function && site.id.value == value)
    };
    for scanner in contexts("parseJsonText", 1) {
        assert_eq!(
            scanner.retention_frontier,
            format!("frame {}", scanner.context)
        );
        assert!(scanner.holders.is_empty(), "nothing holds the scanner");
    }
    for frames in contexts("readValue", 2) {
        assert_eq!(
            frames.retention_frontier,
            format!("frame {}", frames.context)
        );
    }
    for frame in contexts("openFrame", 9) {
        let stack = frame
            .context
            .rsplit_once('/')
            .expect("readValue's arrival")
            .0;
        assert_eq!(frame.retention_frontier, format!("frame {stack}"));
        assert!(
            frame.holders.iter().all(|hold| hold.slot == "Elements"
                && matches!(&hold.holder, hir::memory::Holder::Site { id, .. } if id.function == "readValue" && id.value == 2)),
            "only the frame stack holds a frame: {:?}",
            frame.holders
        );
    }

    // A key list is held both by a parser frame's template and by a result's
    // keys: the sharing the `keys` role names, which `result` arrays lack.
    let held_by = |site: &hir::memory::Site, field: &str, owner: Option<&str>| {
        expanded_holders(report, site).iter().any(|(hold, _)| {
            hold.slot.contains(&format!("\\\"{field}\\\""))
                && match (&hold.holder, owner) {
                    (hir::memory::Holder::Site { id, .. }, Some(owner)) => id.function == owner,
                    (hir::memory::Holder::Class(_), None) => true,
                    _ => false,
                }
        })
    };
    for (function, value, storage, role) in JSON_PARSE_SITES {
        for site in
            contexts(function, *value).filter(|site| format!("{:?}", site.id.storage) == *storage)
        {
            match *role {
                "keys" => assert!(
                    held_by(site, "template", Some("openFrame")) && held_by(site, "keys", None),
                    "{site:?}"
                ),
                "result" if *storage == "Array" => {
                    assert!(!held_by(site, "template", Some("openFrame")), "{site:?}");
                }
                _ => {}
            }
        }
    }
}

/// The controls for json-parse's result and key-list roles: `traversal`'s
/// chain head is returned and nothing else holds it, so it is held for one
/// arrival of its call, while `shared-tail`'s is held by both of its caller's
/// heads, for their frame.
#[test]
fn a_returned_chain_is_held_by_its_links_and_a_shared_tail_by_both_heads() {
    for (case, heads) in [("traversal", 0), ("shared-tail", 2)] {
        let snapshot = snapshot(case);
        let options = hir::Options {
            provider: Memory::ReferenceCounting,
            ..hir::Options::new(
                nts_core::hir::backend::Backend::C,
                nts_core::hir::EntryUnwind::Terminal,
            )
        };
        let prepared = hir::RawProgram::lower(&snapshot, options.entry_files, options.foreign)
            .into_unverified_with_memory(&hir::PreparationOptions::from(&options));
        let report = prepared.memory.as_ref().expect("requested report");
        let head = report
            .sites
            .iter()
            .find(|site| site.id.function == "chain" && site.id.value == 1)
            .expect("the chain's head");
        if heads == 0 {
            // Only the walk reads the list: it is held for one arrival of
            // `chain`'s call, and the proof starts where it was returned.
            assert_eq!(head.retention_frontier, "interval work:entry:%3", "{case}");
            assert!(
                matches!(&head.reached.root, hir::memory::Root::Returned { context } if context.ends_with("/chain:%3")),
                "{case}: {:?}",
                head.reached
            );
        } else {
            // `work`'s own heads hold the shared list, so it lives as long
            // as they do: the proof starts at a head's scope.
            assert_eq!(head.retention_frontier, "frame work:entry", "{case}");
            assert!(
                matches!(&head.reached.edge, hir::memory::Edge::Stored(hold) if hold.slot.contains("next"))
                    && matches!(&head.reached.root, hir::memory::Root::Scope(hir::memory::Holder::Site { id, .. }) if id.function == "work"),
                "{case}: {:?}",
                head.reached
            );
        }
        let holders: Vec<_> = head
            .holders
            .iter()
            .map(|hold| match &hold.holder {
                hir::memory::Holder::Site { id, .. } => (id.function.as_str(), id.value),
                other => panic!("{case}: {other:?}"),
            })
            .collect();
        assert_eq!(
            holders
                .iter()
                .filter(|(function, _)| *function == "work")
                .count(),
            heads,
            "{case}: {holders:?}"
        );
        assert!(
            holders.iter().all(|(function, _)| *function == "work"),
            "{case}: {holders:?}"
        );
    }
}

/// tree-teardown's allocation sites by the role they play in one tree.
///
/// - `node`: an inner node, holding two subtrees built by the recursive calls.
/// - `leaf`: a node at depth zero, with no children.
const TREE_TEARDOWN_SITES: &[(&str, u32, &str, &str)] = &[
    ("build", 4, "Object", "leaf"),
    ("build", 8, "Object", "node"),
];

/// A builder's tree: one arrival of the call that builds it in its caller
/// holds it, so its frontier is that interval. Inside the arrival its
/// instances overlap without bound (the builder recurses), but no arrival's
/// tree survives into the next. Only its own nodes' children hold a node, and
/// a reset at the interval's end still owes the collector's roots
/// (`RuntimeRootContract`) and a bound on what one tree holds
/// (`RepeatedInstances`), so its home is the heap, by name.
fn assert_tree_proof(report: &Report, site: &hir::memory::Site) {
    let owner = site
        .candidate_owner
        .as_deref()
        .expect("the builder has a caller");
    assert_eq!(
        site.retention_frontier,
        format!("interval {owner}"),
        "{site:?}"
    );
    assert_eq!(
        site.home,
        Home::Heap(Reason::OutlivesFrame(owner.to_owned())),
        "{site:?}"
    );
    assert_eq!(
        site.obligations,
        [
            Reason::OutlivesFrame(owner.to_owned()),
            Reason::RepeatedInstances,
            Reason::RuntimeRootContract
        ],
        "{site:?}"
    );
    let hir::memory::Multiplicity::Unbounded { witness } = &site.multiplicity else {
        panic!("one tree has many nodes: {site:?}");
    };
    assert!(
        witness.contains("is a recursive, reentrant or merged activation")
            && !witness.contains("reached more than once"),
        "only the builder's own recursion repeats within one arrival: {witness}"
    );
    assert!(
        matches!(&site.reached.root, hir::memory::Root::Returned { context } if *context == site.context),
        "{:?}",
        site.reached
    );
    assert!(
        site.holders.iter().all(|hold| {
            (hold.slot.contains("\\\"left\\\"") || hold.slot.contains("\\\"right\\\""))
                && matches!(&hold.holder, hir::memory::Holder::Site { id, context }
                    if id.function == "build" && id.value == 8 && *context == site.context_id)
        }) && !site.holders.is_empty(),
        "only a node of the same tree holds a node: {:?}",
        site.holders
    );
    let frontier = report
        .frontiers
        .iter()
        .find(|frontier| frontier.owner == owner)
        .expect("the interval's frontier");
    assert!(frontier.ends.is_ok(), "{frontier:?}");
    assert_eq!(
        frontier.interval,
        Ok(()),
        "everything the call returns is held for one arrival: {frontier:?}"
    );
}

/// Every tree-teardown site has a home and a proof, or a named failure: each
/// maps to an emitted variant, plays one named role, and publishes the same
/// answer three times. Normal preparation runs no solver and the observed
/// preparation is the same program.
#[test]
fn tree_teardown_sites_are_held_for_one_arrival_of_their_builder() {
    let (normal, baseline) = benchmark("tree-teardown");
    assert!(normal.memory.is_none());
    assert_eq!(
        format!("{:?}", normal.program),
        format!("{:?}", baseline.program),
        "the memory report changes no prepared operation"
    );
    let report = baseline.memory.as_ref().expect("requested report");
    assert!(report.failure.is_none(), "{:?}", report.failure);
    let mut seen = std::collections::BTreeSet::new();
    for site in &report.sites {
        assert!(
            !site.legacy.is_empty() && site.legacy_unknown.is_none(),
            "unmapped: {site:?}"
        );
        // Today's placement serves the builder's call with a call region;
        // this proof keeps the tree on the heap, by name, until a reset can
        // discharge the collector's roots and bound one tree's bytes.
        assert_eq!(site.legacy, ["call-region"], "{site:?}");
        assert!(
            matches!(
                site.legacy_agreement(),
                hir::memory::LegacyAgreement::Conservative(Reason::OutlivesFrame(_))
            ),
            "{site:?}"
        );
        assert_tree_proof(report, site);
        seen.insert((
            site.id.function.clone(),
            site.id.value,
            format!("{:?}", site.id.storage),
        ));
    }
    let table: std::collections::BTreeSet<_> = TREE_TEARDOWN_SITES
        .iter()
        .map(|(function, value, storage, _)| {
            ((*function).to_owned(), *value, (*storage).to_owned())
        })
        .collect();
    assert_eq!(seen, table, "every source site has exactly one role");
    let rendered = site_table(report, TREE_TEARDOWN_SITES, None);
    print!("{rendered}");
    assert_eq!(
        rendered,
        include_str!("memory_tree_teardown.tsv"),
        "tree-teardown's published answers moved"
    );
    let first = report.render();
    for _ in 0..2 {
        let repeated = benchmark("tree-teardown").1;
        assert_eq!(
            first,
            repeated.memory.expect("requested").render(),
            "three byte-identical reports"
        );
    }
}

/// The builder fixture's sites, in each of its contexts.
fn builder_sites(case: &str) -> (hir::Prepared, Vec<hir::memory::Site>) {
    let (normal, observed) = prepare_for_bench(&snapshot(case));
    assert_eq!(
        format!("{:?}", normal.program),
        format!("{:?}", observed.program),
        "{case}: the memory report changes no prepared operation"
    );
    let report = observed.memory.as_ref().expect("requested report");
    assert!(report.failure.is_none(), "{case}: {:?}", report.failure);
    let sites: Vec<_> = report
        .sites
        .iter()
        .filter(|site| site.id.function == "build")
        .cloned()
        .collect();
    assert_eq!(sites.len(), 4, "{case}: two sites in two arrivals");
    (observed, sites)
}

/// The fixture and its control differ in one statement: the control also
/// keeps each round's tree in an array that outlives the round. The fixture's
/// trees are held for one arrival of `build`; the control's are held by the
/// array, for the whole of `work`, and its trees overlap across rounds.
#[test]
fn a_tree_builder_site_is_proved_and_a_kept_tree_is_not() {
    let (prepared, proved) = builder_sites("a-tree-builder-site-is-proved");
    let report = prepared.memory.as_ref().expect("requested report");
    for site in &proved {
        assert_tree_proof(report, site);
    }
    let (prepared, kept) = builder_sites("a-tree-builder-site-is-proved-control");
    // The call's scope still ends after its last local read, but the trees
    // it returns are not held for it: the row names the kept array.
    let report = prepared.memory.as_ref().expect("requested report");
    let rows: Vec<_> = report
        .frontiers
        .iter()
        .filter(|frontier| {
            kept.iter()
                .any(|site| site.candidate_owner.as_deref() == Some(frontier.owner.as_str()))
        })
        .collect();
    assert_eq!(rows.len(), 2, "{:?}", report.frontiers);
    for row in rows {
        assert!(row.ends.is_ok(), "{row:?}");
        assert!(
            matches!(&row.interval, Err(why) if why.contains("is held for frame") && why.contains("stored in Elements of work")),
            "{row:?}"
        );
    }
    for site in &kept {
        let caller = site.context.rsplit_once('/').expect("build's caller").0;
        assert_eq!(
            site.retention_frontier,
            format!("frame {caller}"),
            "{site:?}"
        );
        let hir::memory::Multiplicity::Unbounded { witness } = &site.multiplicity else {
            panic!("{site:?}");
        };
        assert!(
            witness.contains("reached more than once in one activation of its caller"),
            "the rounds' trees overlap: {witness}"
        );
        assert!(
            site.holders.iter().any(|hold| hold.slot == "Elements"
                && matches!(&hold.holder, hir::memory::Holder::Site { id, .. }
                    if id.function.starts_with("work") && id.storage == hir::memory::Storage::Array)),
            "the kept array holds the trees: {:?}",
            site.holders
        );
    }
}

/// A workload written beside the test's output, prepared as `nts-bench` does.
fn inline(name: &str, source: &str) -> Report {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .expect("the repository");
    let out = crate::scratch::ScratchDir::path_in_target(&format!("nts-memory-{name}"));
    std::fs::create_dir_all(out.join("src")).expect("scratch");
    std::fs::write(out.join("src/main.ts"), source).expect("written source");
    let tsconfig = out.join("tsconfig.json");
    std::fs::write(
        &tsconfig,
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","include":["src"]}}"#),
    )
    .expect("written config");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("the source captures");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let (_, observed) = prepare_for_bench(&snapshot);
    let report = observed.memory.expect("requested report");
    assert!(report.failure.is_none(), "{name}: {:?}", report.failure);
    report
}

const TREE: &str = "class Tree {
  value: number;
  left: Tree | null;
  right: Tree | null;
  constructor(value: number, left: Tree | null, right: Tree | null) {
    this.value = value;
    this.left = left;
    this.right = right;
  }
}

function build(depth: number): Tree {
  if (depth === 0) return new Tree(1, null, null);
  return new Tree(depth, build(depth - 1), build(depth - 1));
}

function sum(tree: Tree): number {
  let total = tree.value;
  if (tree.left !== null) total = total + sum(tree.left);
  if (tree.right !== null) total = total + sum(tree.right);
  return total;
}
";

/// A caller that can suspend holds its callee's result across the
/// suspension in a frame the program does not end: no interval is proved,
/// and the proof names why.
#[test]
fn a_suspending_caller_proves_no_interval() {
    let report = inline(
        "suspending-builder",
        &format!(
            "{TREE}
export async function work(n: number): Promise<number> {{
  let total = 0;
  for (let round = 0; round < 4; round++) {{
    const root = build(3 + (n & 1));
    await Promise.resolve(round);
    total = total + sum(root);
  }}
  return total;
}}
"
        ),
    );
    let sites: Vec<_> = report
        .sites
        .iter()
        .filter(|site| site.id.function == "build")
        .collect();
    assert!(
        !sites.is_empty(),
        "{:?}",
        report
            .sites
            .iter()
            .map(|site| (&site.id, &site.context))
            .collect::<Vec<_>>()
    );
    for site in sites {
        assert!(
            !site.retention_frontier.starts_with("interval "),
            "{site:?}"
        );
    }
    let refused: Vec<_> = report
        .frontiers
        .iter()
        .filter(|frontier| frontier.interval == Err("its caller can suspend".to_owned()))
        .collect();
    assert!(
        !refused.is_empty(),
        "the refusal is named: {:?}",
        report.frontiers
    );
}

/// A callee that throws after building ends its arrival at the unwinding.
/// Where the thrown value carries the tree into the caller's handler, the
/// tree is not claimed to die within the call's interval: the handler reads
/// it after the call. Where it does not, the tree dies on the throw path and
/// is held for the call's interval.
#[test]
fn a_tree_thrown_into_the_callers_handler_is_not_held_for_the_call() {
    for (name, thrown, handler) in [
        (
            "thrown-builder-dropped",
            "new Error(\"deep\")",
            "total = total + 1;",
        ),
        (
            "thrown-builder-carried",
            "new Thrown(tree)",
            "if (e instanceof Thrown) total = total + sum(e.tree);",
        ),
    ] {
        let report = inline(
            name,
            &format!(
                "{TREE}
class Thrown {{
  tree: Tree;
  constructor(tree: Tree) {{
    this.tree = tree;
  }}
}}

function risky(depth: number): Tree {{
  const tree = build(depth);
  if (depth > 2) throw {thrown};
  return tree;
}}

export function work(n: number): number {{
  let total = 0;
  for (let round = 0; round < 4; round++) {{
    try {{
      total = total + sum(risky((round + n) & 3));
    }} catch (e) {{
      {handler}
    }}
  }}
  return total;
}}
"
            ),
        );
        let sites: Vec<_> = report
            .sites
            .iter()
            .filter(|site| site.id.function == "build")
            .collect();
        assert!(!sites.is_empty(), "{name}");
        for site in sites {
            let caller = site
                .context
                .rsplit_once("/risky@raises:")
                .expect("risky's arrival")
                .0;
            if name.ends_with("carried") {
                // The raise is an unsealed outcome that carries the tree: no
                // scope is proved at all.
                assert!(
                    site.retention_frontier
                        .starts_with("unknown frontier: MissingOutcome("),
                    "{name}: {site:?}"
                );
            } else {
                // The tree is dead on the throw path, so `risky`'s returning
                // path alone keeps it, for one arrival of its call.
                let call = site
                    .context
                    .rsplit_once("/risky@raises:%")
                    .and_then(|(_, rest)| rest.split('/').next())
                    .expect("risky's call");
                assert_eq!(
                    site.retention_frontier,
                    format!("interval {caller}:%{call}"),
                    "{name}: {site:?}"
                );
            }
        }
    }
}

/// A result handed along an edge lives on in the block parameter that
/// receives it. Here the call before the loop hands its list to the loop
/// header, which reads it: its frontier ends after that read, not on the
/// header's entry, and only that call's list is held for one arrival. The
/// call in the loop hands its list to the next pass's header, where the call's
/// block does not dominate, so it proves no interval.
#[test]
fn a_result_carried_into_a_loop_header_is_held_past_the_headers_read() {
    let report = inline(
        "carried-into-a-header",
        "class Link {
  value: number;
  next: Link | null;
  constructor(value: number) {
    this.value = value;
    this.next = null;
  }
}

function chain(length: number): Link {
  const head = new Link(0);
  let tail = head;
  for (let i = 1; i < length; i++) {
    const made = new Link(i);
    tail.next = made;
    tail = made;
  }
  return head;
}

function total(head: Link | null): number {
  let sum = 0;
  let at = head;
  while (at !== null) {
    sum = sum + at.value;
    at = at.next;
  }
  return sum;
}

export function work(n: number): number {
  let prev = chain(4 + n);
  let i = 0;
  while (total(prev) > i) {
    prev = chain(3);
    i = i + 2;
  }
  return i;
}
",
    );
    for frontier in &report.frontiers {
        if let Ok(ends) = &frontier.ends {
            assert!(
                ends.iter().all(|end| !end.starts_with("entry of block")),
                "the header reads the carried list: {frontier:?}"
            );
        }
    }
    let heads: Vec<_> = report
        .sites
        .iter()
        .filter(|site| site.id.function == "chain" && site.id.value == 1)
        .collect();
    assert_eq!(heads.len(), 4, "two calls in work and in work#whole");
    let (held, carried): (Vec<&hir::memory::Site>, Vec<&hir::memory::Site>) = heads
        .iter()
        .copied()
        .partition(|site| site.retention_frontier.starts_with("interval "));
    assert_eq!(held.len(), 2, "{heads:?}");
    for site in carried {
        let caller = site.context.rsplit_once('/').expect("a caller").0;
        assert_eq!(
            site.retention_frontier,
            format!("frame {caller}"),
            "{site:?}"
        );
    }
}

/// A merged context's objects are read out of the call its stores reach:
/// the fifth `leaf` call merges, its object is stored into `build`'s result,
/// and `work` reads it in a later block than anything else it reads out of
/// that result. The lattice places the merged context under `build`'s call,
/// so the reads must be attributed through the same hierarchy; otherwise the
/// interval would end before that last read.
#[test]
fn a_merged_contexts_object_is_read_out_of_the_call_its_stores_reach() {
    let report = inline(
        "merged-into-a-result",
        "class Leaf {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}
class Node5 {
  a: Leaf;
  b: Leaf;
  c: Leaf;
  d: Leaf;
  e: Leaf;
  constructor(a: Leaf, b: Leaf, c: Leaf, d: Leaf, e: Leaf) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
  }
}
function leaf(v: number): Leaf {
  if (v > 1000) return leaf(v - 1000);
  return new Leaf(v);
}
function build(n: number): Node5 {
  return new Node5(leaf(n), leaf(n + 1), leaf(n + 2), leaf(n + 3), leaf(n + 4));
}
function read(l: Leaf): number {
  return l.value;
}
export function work(n: number): number {
  const root = build(n);
  const kept = root.e;
  let total = read(root.a);
  if (n > 3) {
    total = total + 1;
  }
  total = total + read(kept);
  return total;
}
",
    );
    let merged: Vec<_> = report
        .sites
        .iter()
        .filter(|site| site.id.function == "leaf" && site.context.ends_with(":merged"))
        .collect();
    assert!(!merged.is_empty(), "the fifth call merges");
    // `work` reads the merged object last, through `kept`, in block 2: the
    // interval of `build`'s call ends there, and the merged object is held
    // for it.
    let frontier = report
        .frontiers
        .iter()
        .find(|frontier| frontier.owner == "work:entry:%1")
        .expect("build's call in work");
    assert_eq!(
        frontier.ends,
        Ok(vec!["after last reference use in block 2".to_owned()]),
        "{frontier:?}"
    );
    assert_eq!(frontier.interval, Ok(()), "{frontier:?}");
    for site in &merged {
        assert_eq!(
            site.retention_frontier, "interval work:entry:%1",
            "{site:?}"
        );
    }
}

/// What a call returns includes what its result reaches through fields: a
/// `Pair`'s first leaf, kept past the round by `work`'s array, leaves the
/// call's row not held for one arrival, naming the array, though the pair
/// itself and its second leaf are, also when the kept leaf joins a weak
/// class of the caller's own leaves. The controls read the first leaf
/// instead of keeping it, and their rows stay held for one arrival.
#[test]
fn an_object_reached_through_the_result_and_kept_longer_unholds_the_row() {
    // The `wide-` pair seeds `kept` with eight of the caller's leaves, so
    // the kept first leaf joins them in one weak class that a caller's leaf
    // represents: the class still counts as the call's.
    let seeded = "new Leaf(1), new Leaf(2), new Leaf(3), new Leaf(4), new Leaf(5), new Leaf(6), new Leaf(7), new Leaf(8)";
    for (name, seed, use_a, held) in [
        ("pair-kept", "", "kept.push(pair.a);", false),
        ("pair-read", "", "total = total + pair.a.value;", true),
        ("wide-pair-kept", seeded, "kept.push(pair.a);", false),
        (
            "wide-pair-read",
            seeded,
            "total = total + pair.a.value;",
            true,
        ),
    ] {
        let report = inline(
            name,
            &format!(
                "class Leaf {{
  value: number;
  constructor(value: number) {{
    this.value = value;
  }}
}}
class Pair {{
  a: Leaf;
  b: Leaf;
  constructor(a: Leaf, b: Leaf) {{
    this.a = a;
    this.b = b;
  }}
}}
function make(n: number): Pair {{
  return new Pair(new Leaf(n), new Leaf(n + 1));
}}
export function work(n: number): number {{
  const kept: Leaf[] = [{seed}];
  let total = 0;
  for (let round = 0; round < 4; round++) {{
    const pair = make(n + round);
    total = total + pair.b.value;
    {use_a}
  }}
  total = total + kept.length;
  return total;
}}
"
            ),
        );
        let rows: Vec<_> = report
            .frontiers
            .iter()
            .filter(|frontier| {
                report.sites.iter().any(|site| {
                    site.id.function == "make"
                        && site.candidate_owner.as_deref() == Some(frontier.owner.as_str())
                })
            })
            .collect();
        assert_eq!(rows.len(), 2, "{name}: {:?}", report.frontiers);
        for row in rows {
            assert!(row.ends.is_ok(), "{name}: {row:?}");
            if held {
                assert_eq!(row.interval, Ok(()), "{name}: {row:?}");
            } else {
                assert!(
                    matches!(&row.interval, Err(why) if why.contains("stored in Elements of work")),
                    "{name}: {row:?}"
                );
            }
        }
    }
}
