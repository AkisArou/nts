//! The gated fixture for a `StringView` lent straight out of a field while the
//! call it is lent for runs a callback: both backends, reference counting and
//! `AddressSanitizer`. `control`, `subject` and `temporary` must all pass;
//! `subject` was a recorded use-after-free, and `temporary` guards the view
//! leaning on the string it lends (see the fixture's `src/main.ts`).
use super::{Command, clang, hir, prepare_with_files};

const SOURCE: &str =
    include_str!("../../../../../tests/interop/native-string-view-lend/src/main.ts");
const DECLARATIONS: &str =
    include_str!("../../../../../tests/interop/native-string-view-lend/types/visit.d.ts");
const HOST: &str =
    include_str!("../../../../../tests/interop/native-string-view-lend/native/host.c");
const CALLER: &str =
    include_str!("../../../../../tests/interop/native-string-view-lend/consumer/caller.c");

#[test]
fn a_view_lent_from_a_field_outlives_a_callback_that_overwrites_it() {
    let Some((dir, prepared)) = prepare_with_files(
        "string-view-lend",
        SOURCE,
        hir::Provider::ReferenceCounting,
        &[("visit.d.ts", DECLARATIONS)],
    ) else {
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    for file in c.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    for (name, text) in [
        ("program.c", c.writer.text()),
        ("program.ll", llvm.text.as_str()),
        ("host.c", HOST),
        ("caller.c", CALLER),
    ] {
        std::fs::write(dir.join(name), text).unwrap();
    }
    let flags = ["-O1", "-g", "-w", "-fsanitize=address", "-DNTS_PROVIDER_RC"];
    for (source, object) in [
        ("nts_runtime.c", "runtime.o"),
        ("host.c", "host.o"),
        ("caller.c", "caller.o"),
        ("program.c", "c.o"),
    ] {
        clang(
            &dir,
            &[
                &[
                    "-std=gnu11",
                    "-D_GNU_SOURCE",
                    "-I",
                    ".",
                    "-c",
                    source,
                    "-o",
                    object,
                ][..],
                &flags,
            ]
            .concat(),
        );
    }
    clang(
        &dir,
        &[
            &["-Wno-override-module", "-c", "program.ll", "-o", "llvm.o"][..],
            &flags,
        ]
        .concat(),
    );
    for backend in ["c", "llvm"] {
        let executable = format!("{backend}-run");
        clang(
            &dir,
            &[
                &format!("{backend}.o"),
                "runtime.o",
                "host.o",
                "caller.o",
                "-fsanitize=address",
                "-lm",
                "-lpthread",
                "-o",
                &executable,
            ],
        );
        let run = |which: &str| {
            Command::new(dir.join(&executable))
                .arg(which)
                .env("ASAN_OPTIONS", "detect_leaks=0")
                .output()
                .unwrap()
        };
        let control = run("control");
        assert!(
            control.status.success(),
            "{backend}: the control failed: {}",
            String::from_utf8_lossy(&control.stderr)
        );
        for which in ["subject", "temporary"] {
            let run = run(which);
            assert!(
                run.status.success(),
                "{backend} {which}: the lent string was freed before C read it: {}",
                String::from_utf8_lossy(&run.stderr)
            );
        }
    }
}
