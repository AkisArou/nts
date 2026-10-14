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
    let config = root
        .join("tooling/conformance/blockers/an-exported-class-with-a-shared-layout/tsconfig.json");
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
        std::fs::write(dir.join("caller.c"), CALLER).unwrap();
        let binary = dir.join("caller");
        let built = Command::new("clang")
            .args(["-std=c11", "-O1", "-Wall", "-Wextra", "-Werror"])
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
        assert!(result.status.success(), "{provider:?}: {result:?}");
    }
}

const CALLER: &str = r#"
#include "nts_runtime.h"
#include <string.h>
NtsHeader *nts_construct_NtsObj_Shared(void);
NtsHeader *nts_construct_NtsObj_Twin(void);
NtsHeader *nts_construct_NtsObj_Unique(void);
int main(void) {
    NtsHeader *shared = nts_construct_NtsObj_Shared();
    NtsHeader *twin = nts_construct_NtsObj_Twin();
    NtsHeader *unique = nts_construct_NtsObj_Unique();
    if (strcmp(shared->descriptor->name, "Shared") != 0) return 1;
    if (strcmp(twin->descriptor->name, "Twin") != 0) return 2;
    if (strcmp(unique->descriptor->name, "Unique") != 0) return 3;
    if (shared->descriptor == twin->descriptor) return 4;
    nts_release(shared);
    nts_release(twin);
    nts_release(unique);
    return 0;
}
"#;
