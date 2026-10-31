//! A library's exported closure value keeps its real call entry; a private
//! value with the same initializer does not create an outside caller.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, reachable::Roots};
use nts_frontend_ts::Frontend;
use std::process::Command;

const EXPORTED: &str = "a-closure-exported-as-a-value-with-no-typescript-caller-is-an-empty-shell";
const PRIVATE: &str = "a-private-unused-closure-has-no-outside-caller";

fn check(fixture: &str, public: bool) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let config = root
        .join("tests/refusals")
        .join(fixture)
        .join("tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                roots: Roots::EntrySurface,
                ..hir::Options::default()
            },
        )
        .unwrap();
        let program = &prepared.program;
        let global = program.globals.iter().find(|g| g.name == "joiner").unwrap();
        let HirType::Managed(ManagedType::Object(id)) = global.ty else {
            panic!("joiner must carry its actual closure type");
        };
        assert!(hir::has_a_closure_body(id));
        let slot = program.closure_slot.expect("the closure has a typed slot") as usize;
        let layout = program.layout(id).unwrap();
        let entry = layout.methods.get(slot).and_then(Option::as_deref);
        assert_eq!(entry.is_some(), public, "{fixture} {provider:?}: {entry:?}");
        let c = nts_codegen_c::emit(program, hir::native::NativeAbi::LP64);
        let llvm = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(c.diagnostics.is_empty(), "{:?}", c.diagnostics);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        if let Some(entry) = entry {
            let names = nts_codegen_common::source_symbols::SourceSymbols::new(program);
            let symbol = names.function(entry);
            assert!(
                c.writer
                    .text()
                    .lines()
                    .any(|line| line.contains(&format!("{symbol}(")) && line.ends_with(" {")),
                "C call body missing: {symbol}"
            );
            assert!(
                llvm.text.lines().any(
                    |line| line.starts_with("define ") && line.contains(&format!("@{symbol}("))
                ),
                "LLVM call body missing: {symbol}"
            );
        }
        let dir = scratch::ScratchDir::new(&root.join("target/exported-closure-values"), fixture);
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        for (source, object) in [("program.c", "c.o"), ("program.ll", "llvm.o")] {
            let compiled = Command::new("clang")
                .args(["-std=c11", "-c", "-I"])
                .arg(dir.as_std_path())
                .arg(dir.join(source))
                .arg("-o")
                .arg(dir.join(object))
                .output()
                .unwrap();
            assert!(
                compiled.status.success(),
                "{fixture} {provider:?} {source}: {}",
                String::from_utf8_lossy(&compiled.stderr)
            );
        }
    }
}

#[test]
fn exported_value_keeps_its_c_and_llvm_call_body() {
    check(EXPORTED, true);
}

#[test]
fn the_same_private_arrow_stays_dead() {
    check(PRIVATE, false);
}

#[test]
fn only_the_selected_library_surface_is_an_outside_caller() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let config = root
        .join("tests/refusals")
        .join(EXPORTED)
        .join("tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors());
    let original = hir::lower::lower(&snapshot).program;
    let global = original
        .globals
        .iter()
        .find(|g| g.name == "joiner")
        .unwrap();
    let HirType::Managed(ManagedType::Object(id)) = global.ty else {
        panic!("closure type");
    };
    let slot = original.closure_slot.unwrap() as usize;
    let name = original.layout(id).unwrap().methods[slot]
        .as_ref()
        .unwrap()
        .clone();
    let selected = vec!["joiner".to_owned(), "lastSeen".to_owned()];
    let hidden = vec!["lastSeen".to_owned()];
    let entry = vec![hir::lower::MODULE_INIT.to_owned(), "lastSeen".to_owned()];
    for (roots, kept) in [
        (Roots::EveryExport, true),
        (Roots::EntrySurface, true),
        (Roots::Declared(&selected), true),
        (Roots::Declared(&hidden), false),
        (Roots::Entry(&entry), false),
    ] {
        let mut program = original.clone();
        hir::reachable::prune(&mut program, roots);
        assert_eq!(
            program.funcs.iter().any(|f| f.name == name),
            kept,
            "{roots:?}"
        );
    }
    // An imported module can export a binding without the entry publishing it.
    let mut hidden = original.clone();
    hidden.public_api.retain(|(emitted, _)| emitted != "joiner");
    let mut every = hidden.clone();
    hir::reachable::prune(&mut every, Roots::EveryExport);
    assert!(every.funcs.iter().any(|f| f.name == name));
    hir::reachable::prune(&mut hidden, Roots::EntrySurface);
    assert!(hidden.funcs.iter().all(|f| f.name != name));
    let mut namespace = original;
    namespace
        .public_api
        .retain(|(emitted, _)| emitted != "joiner");
    namespace.public_namespaces.push((
        "namespace".to_owned(),
        vec![("alias".to_owned(), "joiner".to_owned())],
    ));
    hir::reachable::prune(&mut namespace, Roots::EntrySurface);
    assert!(namespace.funcs.iter().any(|f| f.name == name));
}
