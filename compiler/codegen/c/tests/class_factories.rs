//! Factories allocate semantic class identities over shared physical storage.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

#[test]
fn exported_classes_on_one_shape_have_distinct_native_identities() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        eprintln!("SKIP class factories: tsgo is required");
        return;
    };
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let config = root.join("tests/refusals/an-exported-class-with-a-shared-layout/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    assert!(!snapshot.has_errors());
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let options = hir::Options {
            provider,
            roots: hir::reachable::Roots::EntrySurface,
            ..hir::Options::new(hir::InterfaceAccess::Materialize)
        };
        let prepared = hir::prepare_with(&snapshot, &options).unwrap();
        let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        let dir = scratch::ScratchDir::new(&root.join("target/class-factory-tests"), "identities");
        std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
        let mut sources = vec![dir.join("program.c").into_std_path_buf()];
        for file in emitted.support_files() {
            let path = file.write(dir.as_std_path()).unwrap();
            if file.compiled {
                sources.push(path);
            }
        }
        check_factory_name_collisions(&prepared.program);
        let mut caller = CALLER.to_owned();
        for class in prepared.program.published_classes() {
            let layout = prepared.program.layout(class.receiver).unwrap();
            caller = caller.replace(
                &format!("nts_construct_NtsObj_{}", class.emitted),
                &format!(
                    "nts_construct_{}",
                    nts_codegen_c::class_instance_name(&prepared.program, layout, class)
                ),
            );
        }
        std::fs::write(dir.join("caller.c"), caller).unwrap();
        let binary = dir.join("caller");
        let mut cc = Command::new("clang");
        cc.args(["-std=c11", "-O1", "-Wall", "-Wextra", "-Werror"]);
        if provider == hir::Provider::ReferenceCounting {
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
            "{}",
            String::from_utf8_lossy(&built.stderr)
        );
        let result = Command::new(binary).output().unwrap();
        assert!(
            result.status.success(),
            "{provider:?}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
}

fn check_factory_name_collisions(program: &hir::Program) {
    let class = program
        .published_classes()
        .find(|class| class.emitted == "Unique")
        .unwrap();
    let layout = program.layout(class.receiver).unwrap();
    let factory = format!(
        "nts_construct_{}",
        nts_codegen_c::class_instance_name(program, layout, class)
    );
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
        let emitted = nts_codegen_c::emit(&probe, hir::native::NativeAbi::LP64);
        let collision = emitted
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "NTS2004");
        assert_eq!(collision.is_some(), collides, "{:?}", emitted.diagnostics);
        if let Some(collision) = collision {
            assert!(collision.message.contains(&factory));
            assert!(nts_codegen_c::leaves_the_program_inconsistent(collision));
        } else {
            assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        }
    }
}

const CALLER: &str = r#"
#include "nts_runtime.h"
#include <string.h>
#include <stdio.h>
NtsHeader *nts_construct_NtsObj_Shared(void);
NtsHeader *nts_construct_NtsObj_Twin(void);
NtsHeader *nts_construct_NtsObj_Unique(void);
NtsHeader *nts_construct_NtsObj_Solo(void);
int main(void) {
    NtsHeader *shared = nts_construct_NtsObj_Shared();
    NtsHeader *twin = nts_construct_NtsObj_Twin();
    NtsHeader *unique = nts_construct_NtsObj_Unique();
    NtsHeader *solo = nts_construct_NtsObj_Solo();
    if (strcmp(shared->descriptor->name, "Shared") != 0) return 1;
    if (strcmp(twin->descriptor->name, "Twin") != 0) return 2;
    if (strcmp(unique->descriptor->name, "Unique") != 0) return 3;
    if (shared->descriptor == twin->descriptor) return 4;
    if (strcmp(solo->descriptor->name, "Solo") != 0) {
        fprintf(stderr, "Solo's descriptor: %s\n", solo->descriptor->name);
        return 5;
    }
    nts_release(shared);
    nts_release(twin);
    nts_release(unique);
    nts_release(solo);
    return 0;
}
"#;
