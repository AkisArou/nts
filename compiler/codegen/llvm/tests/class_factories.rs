//! Every class an LLVM module publishes has its construction entry (#500).
//!
//! The publication record is `construction_entries`, which the C backend and
//! the Node-API layer read too. Classes that share one storage keep their own
//! descriptor, so the factory a host calls allocates the class it named.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::scratch;

use camino::Utf8Path;
use nts_codegen_common::publication::construction_entries;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::fmt::Write as _;
use std::process::Command;

#[test]
fn every_published_class_has_an_llvm_construction_entry() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let config = root.join("tests/refusals/an-exported-class-with-a-shared-layout/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let options = hir::Options {
            provider,
            roots: hir::reachable::Roots::EntrySurface,
            ..hir::Options::new(
                hir::backend::Backend::Llvm,
                nts_core::hir::EntryUnwind::Terminal,
            )
        };
        let prepared = hir::prepare_with(&snapshot, &options).unwrap();
        let program = &prepared.program;
        let entries = construction_entries(program);
        let published: Vec<&str> = program.published_classes().map(|c| c.emitted).collect();
        assert_eq!(
            entries.iter().map(|e| e.class.emitted).collect::<Vec<_>>(),
            published,
            "every published class has a construction entry"
        );
        let llvm = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        for entry in &entries {
            let defined = format!("define ptr @{}() ", entry.symbol());
            assert_eq!(
                llvm.text
                    .lines()
                    .filter(|line| line.starts_with(&defined))
                    .count(),
                1,
                "{provider:?}: LLVM defines {} once",
                entry.symbol()
            );
        }

        // The runtime comes from the C backend's support files, as an LLVM
        // addon's does; the caller allocates each class through its factory.
        let c = nts_codegen_c::emit(program, hir::native::NativeAbi::LP64);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        let dir = scratch::ScratchDir::new(
            &root.join("target/llvm-class-factory-tests"),
            &format!("{provider:?}"),
        );
        std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
        let mut sources = vec![dir.join("program.ll").into_std_path_buf()];
        for file in c.support_files() {
            let path = file.write(dir.as_std_path()).unwrap();
            if file.compiled {
                sources.push(path);
            }
        }
        let mut caller = String::from(CALLER_HEAD);
        let mut body = String::new();
        for (at, entry) in entries.iter().enumerate() {
            let symbol = entry.symbol();
            let _ = writeln!(caller, "NtsHeader *{symbol}(void);");
            let _ = write!(
                body,
                "    made[{at}] = {symbol}();\n    if (strcmp(made[{at}]->descriptor->name, \"{}\") != 0) {{ fprintf(stderr, \"{symbol}: %s\\n\", made[{at}]->descriptor->name); return 1; }}\n",
                entry.class.identity.name
            );
        }
        let _ = write!(
            caller,
            "int main(void) {{\n    NtsHeader *made[{}];\n{body}    for (int i = 0; i < {}; i++) for (int j = 0; j < i; j++) if (made[i]->descriptor == made[j]->descriptor) return 2;\n    for (int i = 0; i < {}; i++) nts_release(made[i]);\n    return 0;\n}}\n",
            entries.len(),
            entries.len(),
            entries.len()
        );
        std::fs::write(dir.join("caller.c"), caller).unwrap();
        let binary = dir.join("caller");
        let mut cc = Command::new("clang");
        cc.args(["-std=c11", "-O1", "-Wno-override-module"]);
        if provider == hir::Memory::ReferenceCounting {
            cc.arg("-DNTS_PROVIDER_RC");
        }
        let built = cc
            .arg("-I")
            .arg(dir.as_std_path())
            .args(sources)
            .arg(dir.join("caller.c"))
            .args(["-lm", "-o"])
            .arg(&binary)
            .output()
            .unwrap();
        assert!(
            built.status.success(),
            "{provider:?}: {}",
            String::from_utf8_lossy(&built.stderr)
        );
        let result = Command::new(&binary).output().unwrap();
        assert!(
            result.status.success(),
            "{provider:?}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
}

/// A factory's complete name is claimed in the functions' namespace: a
/// function already spelled as it refuses the module instead of redefining it.
#[test]
fn a_function_named_as_a_factory_refuses_the_llvm_module() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let config = root.join("tests/refusals/an-exported-class-with-a-shared-layout/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            roots: hir::reachable::Roots::EntrySurface,
            ..hir::Options::new(
                hir::backend::Backend::Llvm,
                nts_core::hir::EntryUnwind::Terminal,
            )
        },
    )
    .unwrap();
    let program = &prepared.program;
    let factory = construction_entries(program)
        .into_iter()
        .find(|entry| entry.class.emitted == "Unique")
        .unwrap()
        .symbol();
    for (name, collides) in [
        (factory.clone(), true),
        (format!("{factory}_distinct"), false),
    ] {
        let mut probe = program.clone();
        let mut function = probe
            .funcs
            .iter()
            .find(|func| func.name == "earlierControl")
            .unwrap()
            .clone();
        function.name = name;
        probe.funcs.push(function);
        let emitted = nts_codegen_llvm::emit(&probe, nts_codegen_llvm::Platform::SYSV_X86_64);
        let collision = emitted
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "NTS2004");
        assert_eq!(collision.is_some(), collides, "{:?}", emitted.diagnostics);
        if let Some(collision) = collision {
            assert!(collision.message.contains(&factory));
        } else {
            assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
        }
    }
}

const CALLER_HEAD: &str = r#"
#include "nts_runtime.h"
#include <string.h>
#include <stdio.h>
"#;
