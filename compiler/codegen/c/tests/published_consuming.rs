//! A refusal inside the private body keeps the published source identity.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "../../common/test-support/published_consuming.rs"]
mod fixture;

#[test]
fn a_materialized_bodys_refusal_names_the_original_function() {
    let emitted = nts_codegen_c::emit(
        &fixture::refused_body(nts_core::hir::backend::Backend::C),
        nts_core::hir::native::NativeAbi::LP64,
    );
    fixture::assert_source_name(&emitted.diagnostics);
}

#[test]
fn an_internal_numeric_specialization_emits_no_borrowed_adapter() {
    use camino::Utf8Path;
    use nts_frontend_ts::Frontend;
    use std::process::Command;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let config = root.join(
        "tests/programs/a-published-method-specialization-has-no-borrowed-caller/tsconfig.json",
    );
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors());
    let prepared = nts_core::hir::prepare_with(
        &snapshot,
        &nts_core::hir::Options {
            provider: nts_core::hir::Memory::ReferenceCounting,
            ..nts_core::hir::Options::new(
                nts_core::hir::backend::Backend::C,
                nts_core::hir::EntryUnwind::Terminal,
            )
        },
    )
    .unwrap();
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|func| func.name == "Holder#put#whole")
    );
    assert!(
        !prepared
            .program
            .funcs
            .iter()
            .any(|func| func.name == "@consuming:Holder#put#whole")
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let dir =
        crate::scratch::ScratchDir::new(&root.join("target/published-specialization"), "warnings");
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    let checked = Command::new("clang")
        .current_dir(&dir)
        .args([
            "-std=c11",
            "-O2",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-DNTS_PROVIDER_RC",
            "-I.",
            "-c",
            "program.c",
            "-o",
            "program.o",
        ])
        .output()
        .unwrap();
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
}

#[test]
fn closed_towers_hands_over_every_push_at_the_memory_minimum() {
    use camino::Utf8Path;
    use nts_core::hir::{self, reachable::Roots};
    use nts_frontend_ts::Frontend;
    use std::process::Command;

    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let config =
        root.join("compiler/codegen/c/tests/programs/published-consuming-towers/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let entries = vec!["work".to_owned(), "module#init".to_owned()];
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            roots: Roots::Entry(&entries),
            provider: hir::Memory::ReferenceCounting,
            callbacks_checkpoint: false,
            ..hir::Options::new(
                nts_core::hir::backend::Backend::C,
                nts_core::hir::EntryUnwind::Terminal,
            )
        },
    )
    .unwrap();
    assert!(prepared.rejected.is_empty(), "{:?}", prepared.rejected);
    assert!(prepared.entry_decisions.iter().any(|decision| {
        decision.function == "Towers#pushDisk"
            && decision.kind == hir::own::EntryDecisionKind::Selected
    }));
    let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let dir = crate::scratch::ScratchDir::new(&root.join("target/published-towers"), "minimum");
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    let mut sources = vec![dir.join("program.c").into_std_path_buf()];
    for file in emitted.support_files() {
        let path = file.write(dir.as_std_path()).unwrap();
        if path.file_name().is_some_and(|name| name == "nts_runtime.c") {
            observe_effective_counts(&path);
        }
        if file.compiled {
            sources.push(path);
        }
    }
    let harness = std::fs::read_to_string(root.join("tooling/memory/harness.c")).unwrap();
    let harness = harness.replace(
        "  nts_collect_cycles();\n  size_t after",
        "  printf(\"effective-releases=%llu null-retains=%llu null-releases=%llu\\n\", towers_effective_count(), towers_null_retain_count(), towers_null_release_count());\n  nts_collect_cycles();\n  size_t after",
    );
    let declarations = "unsigned long long towers_effective_count(void);\nunsigned long long towers_null_retain_count(void);\nunsigned long long towers_null_release_count(void);\n";
    std::fs::write(dir.join("harness.c"), format!("{declarations}{harness}")).unwrap();
    let built = Command::new("clang")
        .args([
            "-std=c11",
            "-O2",
            "-DNTS_PROVIDER_RC",
            "-DNTS_COUNT_OPERATIONS",
            "-DNTS_POISON",
            "-I",
        ])
        .arg(&dir)
        .args(&sources)
        .arg(dir.join("harness.c"))
        .args(["-lm", "-o"])
        .arg(dir.join("run"))
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let ran = Command::new(dir.join("run")).output().unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    let output = String::from_utf8_lossy(&ran.stdout);
    let value = |key: &str| {
        output
            .split_whitespace()
            .find_map(|part| {
                part.strip_prefix(key)
                    .map(|number| number.parse::<i64>().unwrap())
            })
            .unwrap()
    };
    // #916: the shared body still attempts a release of old disk.next on each
    // of 8,205 pushes. These are null stores, not the moved argument's cleanup.
    assert_eq!(value("retains="), 3, "{output}");
    assert_eq!(value("releases="), 8224, "{output}");
    assert_eq!(value("null-retains="), 3, "{output}");
    assert_eq!(value("null-releases="), 8209, "{output}");
    assert_eq!(value("effective-releases="), 15, "{output}");
    assert_eq!(value("allocated="), 15, "{output}");
    assert_eq!(value("leaked="), 0, "{output}");
    assert_eq!(value("answer="), 1, "{output}");
}

fn observe_effective_counts(path: &std::path::Path) {
    // Test-only observation of effective changes, distinct from the
    // runtime's attempted-operation counters. Production is untouched.
    let runtime = std::fs::read_to_string(path).unwrap();
    let release = "void nts_release(NtsHeader *object) {";
    let retain = "void nts_retain(NtsHeader *object) {";
    let reset = "void nts_counting_reset(void) {";
    for definition in [release, retain, reset] {
        assert_eq!(runtime.matches(definition).count(), 1);
    }
    let counters = "static unsigned long long towers_effective, towers_null_retains, towers_null_releases;\nunsigned long long towers_effective_count(void){return towers_effective;}\nunsigned long long towers_null_retain_count(void){return towers_null_retains;}\nunsigned long long towers_null_release_count(void){return towers_null_releases;}\n";
    let runtime = runtime
    .replace(release, &format!("{release} if(!object) towers_null_releases++; else if(object->reserved!=NTS_IMMORTAL && !(object->flags & NTS_DYING)) towers_effective++;"))
    .replace(retain, &format!("{retain} if(!object) towers_null_retains++;"))
    .replace(reset, &format!("{reset} towers_effective=0; towers_null_retains=0; towers_null_releases=0;"));
    std::fs::write(path, format!("{counters}{runtime}")).unwrap();
}
