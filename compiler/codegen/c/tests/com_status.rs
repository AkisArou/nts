//! Recorded gap: direct-C `@ntsHresult` fixes the hidden status to `int32_t`.
//! LLP64 long is also signed 32-bit, but the exact-prototype witness rejects it.
//! The one-difference int control compiles. A compiler fix must carry the
//! header's status C spelling, then turn the long rejection into a guard.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "../../../test-support/scratch.rs"]
mod scratch;
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use scratch::ScratchDir;
use std::process::Command;

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "Complete provider/target matrix and one-difference compile control"
)]
fn recorded_gap_direct_hresult_status_long_is_rejected_on_llp64() {
    if !Command::new("zig")
        .arg("version")
        .output()
        .is_ok_and(|o| o.status.success())
    {
        eprintln!("skipped: no zig cross compiler");
        return;
    }
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    for provider in [hir::Provider::NoGc, hir::Provider::ReferenceCounting] {
        let dir = ScratchDir::new(
            &root.join("target/com-status-tests"),
            &format!("{provider:?}"),
        );
        std::fs::write(
            dir.join("main.ts"),
            r#"
import { Next } from "c:StatusFixture";
import type { c_int } from "@nts/scalars";
export function run(value: c_int): c_int { return Next(value); }
"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("binding.d.ts"),
            r#"
/** @ntsHeader "status.h" */
declare module "c:StatusFixture" {
  import type { c_int } from "@nts/scalars";
  /** @ntsHresult */
  export function Next(value: c_int): c_int;
}
"#,
        )
        .unwrap();
        std::fs::write(dir.join("tsconfig.json"),format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts"]}}"#)).unwrap();
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&dir.join("tsconfig.json"))
            .unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::default()
            },
        )
        .unwrap();
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LLP64);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        assert!(
            !emitted.witness.is_empty(),
            "a prototype check must actually be emitted"
        );
        for file in emitted.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        std::fs::write(dir.join("witness.c"), &emitted.witness).unwrap();
        for target in ["x86_64-windows-gnu", "aarch64-windows-gnu"] {
            for status in ["int", "long"] {
                // This typedef is the only difference. Both types are proven
                // 32-bit on the actual target, not merely assumed from the host.
                std::fs::write(dir.join("status.h"),format!("#include <stdint.h>\n_Static_assert(sizeof(long)==4 && sizeof(int32_t)==4,\"LLP64 status widths\");\ntypedef {status} Status;\nStatus Next(int value,int *output);\n")).unwrap();
                let output = Command::new("zig")
                    .current_dir(&dir)
                    .args([
                        "cc",
                        "-target",
                        target,
                        "-std=gnu11",
                        "-c",
                        "witness.c",
                        "-o",
                        "witness.o",
                    ])
                    .output()
                    .unwrap();
                let diagnostic = String::from_utf8_lossy(&output.stderr);
                eprintln!(
                    "{provider:?} {target} status={status}: exit={:?}",
                    output.status.code()
                );
                if status == "int" {
                    assert!(output.status.success(), "control: {diagnostic}");
                } else {
                    // Recorded defect. Do not ignore this test: flip it into
                    // acceptance when the header status type reaches the call.
                    assert!(
                        !output.status.success(),
                        "the recorded rejection changed; make this a guard"
                    );
                    assert!(
                        diagnostic.contains("the header declares Next as the binding does"),
                        "{diagnostic}"
                    );
                    assert!(
                        diagnostic.contains("__builtin_types_compatible_p"),
                        "{diagnostic}"
                    );
                }
            }
        }
    }
}
