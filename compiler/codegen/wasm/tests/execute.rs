//! Prepared TypeScript → bytes → validator → Node loader → same-source answers.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::path::Path;

fn prepared_project(fixture: &Path) -> hir::Program {
    let tsgo = std::env::var("NTS_TSGO")
        .expect("NTS_TSGO required: wasm execution tests must not silently skip");
    let tsconfig = Utf8PathBuf::from_path_buf(fixture.join("tsconfig.json")).unwrap();
    let snapshot = TsgoApi::for_compilation(Utf8PathBuf::from(tsgo))
        .snapshot(&tsconfig)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:#?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::HostGc,
            ..hir::Options::new(hir::InterfaceAccess::PreserveFieldAccess)
        },
    )
    .expect("prepared HIR verifies");
    for func in &prepared.program.funcs {
        for block in &func.blocks {
            for &id in &block.ops {
                if let hir::OpKind::Call {
                    callee: hir::Callee::External(name),
                    ..
                } = &func.value(id).kind
                {
                    assert!(
                        nts_codegen_wasm::helper_support(name).is_some(),
                        "unclassified prepared helper {name} in {} ({})",
                        func.name,
                        fixture.display()
                    );
                }
            }
        }
    }
    prepared.program
}

fn emit_project(fixture: &Path) -> nts_codegen_wasm::Emitted {
    let program = prepared_project(fixture);
    nts_codegen_wasm::emit(&program).unwrap_or_else(|error| {
        if let nts_codegen_wasm::EmitError::Invariant { function, .. } = &error {
            eprintln!("{:?}", program.funcs.iter().find(|f| &f.name == function));
        }
        panic!("fixture {}: {error}", fixture.display());
    })
}

/// Two same-shape classes from unrelated dispatch hierarchies are one Wasm
/// type to the engine, but their vtables give one slot two meanings: moving
/// one into the other is refused by name, never run as the wrong method.
///
/// **The lowering refuses it now, before any backend sees it.** A call through
/// `P` names `P`'s methods on every backend, not only through a Wasm vtable,
/// so an object of the unrelated `Q` held at `P` is refused where it is
/// converted (`unrelated_class_keeps_its_methods`); `asP` and its caller never
/// reach this emitter. The Wasm transfer refusal stays for storage the
/// lowering admits -- tests/transfer.rs pins it on a method-less pair.
#[test]
fn a_class_from_an_unrelated_hierarchy_of_one_shape_is_refused() {
    let fixture = common::repository().join("tooling/wasm/fixtures/unrelated-hierarchies");
    let program = prepared_project(&fixture);
    let refused = program
        .uncompiled
        .iter()
        .find(|(name, _)| name == "asP")
        .map(|(_, why)| why.as_str());
    assert!(
        refused.is_some_and(|why| why.contains("where the unrelated class `P` is wanted")),
        "{:?}",
        program.uncompiled
    );
    assert!(
        !program
            .funcs
            .iter()
            .any(|func| func.name == "asP" || func.name == "probe"),
        "neither the conversion nor its caller is compiled"
    );
}

/// Same-shape unrelated classes with fields only: the lowering admits the move,
/// and Wasm's transfer decides it by storage. Storage that one declared parent
/// separates is refused by name; storage of one shape is one type and agrees.
#[test]
fn a_class_whose_storage_has_other_parents_is_refused() {
    let fixture = common::repository().join("tooling/wasm/fixtures/storage-of-other-parents");
    let error = nts_codegen_wasm::emit(&prepared_project(&fixture))
        .map(|_| ())
        .unwrap_err()
        .to_string();
    assert!(
        error.contains(
            "NTS5001: wasm declines `as1`: a `S2` where a `S1` is wanted: no Wasm cast relates their storage"
        ),
        "{error}"
    );
}
#[test]
fn same_shape_classes_without_parents_share_storage_and_agree() {
    let fixture = common::repository().join("tooling/wasm/fixtures/storage-of-one-shape");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "storage-of-one-shape",
        &emitted,
        "tooling/wasm/check-example.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 34, "{output}");
    assert_eq!(output["declined"], 0, "{output}");
}

#[test]
fn source_typed_holes_decline_instead_of_returning_zero() {
    let fixture = common::repository().join("tooling/wasm/fixtures/array-holes");
    let program = prepared_project(&fixture);
    let nts_codegen_wasm::EmitError::Declined(diagnostics) =
        nts_codegen_wasm::emit(&program).unwrap_err()
    else {
        panic!("expected typed-hole decline")
    };
    assert!(
        diagnostics.iter().any(|d| d.code == "NTS5001"
            && d.message.contains("hole")
            && d.message.contains("typed array holes")),
        "{diagnostics:?}"
    );
}

#[test]
fn source_array_helpers_agree_with_node() {
    let fixture = common::repository().join("tooling/wasm/fixtures/array-methods");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-methods-source",
        &emitted,
        "tooling/wasm/check-array-methods-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 1386);
}

#[test]
fn source_array_lookup_agrees_with_node() {
    let fixture = common::repository().join("tooling/wasm/fixtures/array-lookup");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-lookup-source",
        &emitted,
        "tooling/wasm/check-array-lookup-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert!(output["cases"].as_u64().unwrap() > 5000, "{output}");
}

#[test]
fn source_array_element_reads_agree_with_node() {
    let fixture = common::repository().join("tooling/wasm/fixtures/array-element");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-element-source",
        &emitted,
        "tooling/wasm/check-array-element-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 1286, "{output}");
    assert_eq!(output["named_declines"], 1, "{output}");
}

#[test]
fn source_array_joins_agree_with_node() {
    let fixture = common::repository().join("tooling/wasm/fixtures/array-join");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-join-source",
        &emitted,
        "tooling/wasm/check-array-join-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 1249, "{output}");
}

#[test]
fn source_array_sorts_agree_with_node() {
    let fixture = common::repository().join("tooling/wasm/fixtures/array-sort");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-sort-source",
        &emitted,
        "tooling/wasm/check-array-sort-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert_eq!(output["cases"], 328, "{output}");
    assert_eq!(output["named_declines"], 1, "{output}");
}

/// A run-time refusal names its function and its cause.
#[test]
fn source_refusals_name_their_cause() {
    let fixture = common::repository().join("tooling/wasm/fixtures/refusal-causes");
    let emitted = emit_project(&fixture);
    let output = common::run(
        "refusal-causes",
        &emitted,
        "tooling/wasm/check-refusal-causes.mjs",
        &[],
    );
    assert_eq!(output["causes"], 4, "{output}");
}

#[test]
fn source_array_copying_agrees_with_node() {
    let fixture = common::repository().join("tooling/wasm/fixtures/array-copy");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "array-copy-source",
        &emitted,
        "tooling/wasm/check-array-copy-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert!(output["cases"].as_u64().unwrap() > 2000);
    assert!(output["named_declines"].as_u64().unwrap() > 500);
}

#[test]
fn source_raising_slots_handlers_and_finalizers_agree_with_node() {
    let fixture = common::repository().join("tooling/wasm/fixtures/raising");
    let emitted = emit_project(&fixture);
    let output = common::run_with_node_flags(
        "raising-source",
        &emitted,
        "tooling/wasm/check-raising-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert!(output["cases"].as_u64().unwrap() > 150);
    assert!(output["thrownCases"].as_u64().unwrap() > 50);
}

#[test]
fn source_raising_slot_contract_survives_body_renaming() {
    let fixture = common::repository().join("tooling/wasm/fixtures/raising");
    let mut program = prepared_project(&fixture);
    let renames: std::collections::BTreeMap<_, _> = program
        .funcs
        .iter()
        .filter(|f| f.name.contains("@raises"))
        .enumerate()
        .map(|(at, f)| (f.name.clone(), format!("arbitrary_raised_entry_{at}")))
        .collect();
    assert!(!renames.is_empty());
    let rename = |name: &mut String| {
        if let Some(replacement) = renames.get(name) {
            name.clone_from(replacement);
        }
    };
    for f in &mut program.funcs {
        rename(&mut f.name);
        for op in &mut f.values {
            if let hir::OpKind::Call { callee, .. } = &mut op.kind {
                match callee {
                    hir::Callee::Direct(name) | hir::Callee::Virtual { declared: name, .. } => {
                        rename(name);
                    }
                    hir::Callee::External(_)
                    | hir::Callee::Native(_)
                    | hir::Callee::Closure { .. } => {}
                }
            }
        }
    }
    for layout in &mut program.layouts {
        for name in layout.methods.iter_mut().flatten() {
            rename(name);
        }
    }
    for (name, _) in &mut program.public_api {
        rename(name);
    }
    // The native rows are a projection of the layouts' rows, interned by name;
    // project the renamed ones, as preparation would have.
    hir::native_dispatch::plan(&mut program);
    let emitted = nts_codegen_wasm::emit(&program).unwrap();
    let output = common::run_with_node_flags(
        "raising-renamed-source",
        &emitted,
        "tooling/wasm/check-raising-source.mjs",
        &[&fixture.join("src/main.ts")],
        &["--experimental-transform-types"],
    );
    assert!(output["cases"].as_u64().unwrap() > 150);
}

#[test]
fn scalar_typescript_agrees_with_node_exactly() {
    let fixture = common::repository().join("tooling/wasm/fixtures/scalars");
    let emitted = emit_project(&fixture);
    let output = common::run(
        "scalars",
        &emitted,
        "tooling/wasm/check-scalars.mjs",
        &[&fixture.join("src/main.ts")],
    );
    assert!(output["cases"].as_u64().unwrap() >= 150_000, "{output}");
    println!("{output}");
    assert!(
        !emitted.origins.is_empty(),
        "instructions preserve HIR Origins"
    );
}

#[test]
fn existing_loops_and_bitwise_examples_agree_with_node() {
    for (name, expected) in [("loops", 102), ("bitwise", 136)] {
        let fixture = common::repository().join("examples").join(name);
        let emitted = emit_project(&fixture);
        let output = common::run(
            name,
            &emitted,
            "tooling/wasm/check-example.mjs",
            &[&fixture.join("src/main.ts")],
        );
        assert_eq!(output["cases"], expected, "{output}");
        assert_eq!(output["declined"], 0);
        println!("{name}: {output}");
    }
}
