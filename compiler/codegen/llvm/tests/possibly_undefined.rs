//! Execute the same optional-value contract through LLVM and an independent
//! C caller, under native counting and sanitizers.
use camino::Utf8Path;
use nts_core::hir::{self, native::NativeAbi};
use std::fmt::Write as _;
use std::process::Command;
#[path = "../../../test-support/optional.rs"]
mod fixture;
#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

fn checked(command: &mut Command) {
    let result = command.output().expect("run toolchain");
    assert!(
        result.status.success(),
        "{command:?}: {:?}\n{}\n{}",
        result.status,
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn optional_pairs_preserve_bits_absence_null_and_conditional_ownership() {
    for rc in [false, true] {
        let mut program = fixture::program();
        assert_eq!(hir::verify::verify(&program), Ok(()));
        if rc {
            program.provider = hir::Memory::ReferenceCounting;
            hir::rc::insert(&mut program);
        }
        assert_eq!(hir::verify::verify(&program), Ok(()));
        let emitted = nts_codegen_c::emit(&program, NativeAbi::LP64);
        assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
        assert!(emitted.refused.is_empty(), "{:?}", emitted.refused);
        let scratch = ScratchDir::new(Utf8Path::new(env!("CARGO_TARGET_TMPDIR")), "optional-llvm");
        for file in emitted.support_files() {
            let path = scratch.join(file.name);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("support parent");
            }
            std::fs::write(path, file.contents).expect("support file");
        }
        let module = nts_codegen_llvm::emit(&program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(module.diagnostics.is_empty(), "{:?}", module.diagnostics);
        std::fs::write(scratch.join("program.ll"), module.text).expect("LLVM");
        std::fs::write(scratch.join("program.h"), emitted.header).expect("header");
        let mut driver = String::from("#include \"program.h\"\n");
        for (_, payload) in fixture::payloads() {
            let optional = fixture::optional(&payload);
            let shape = hir::layout::shape_of(&optional).expect("optional shape");
            let physical = hir::possibly_undefined::Payload::new(payload)
                .expect("payload")
                .native_name();
            writeln!(
                driver,
                "_Static_assert(sizeof({physical}) == {}, \"optional size\");",
                shape.size
            )
            .expect("string");
            writeln!(
                driver,
                "_Static_assert(_Alignof({physical}) == {}, \"optional alignment\");",
                shape.align
            )
            .expect("string");
        }
        driver.push_str(fixture::NATIVE_DRIVER);
        std::fs::write(scratch.join("main.c"), driver).expect("driver");
        let mut build = Command::new("clang");
        build.current_dir(scratch.as_std_path()).args([
            "-std=c11",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-O1",
            "-fno-inline",
            "-Wno-override-module",
        ]);
        if rc {
            build.args([
                "-DNTS_PROVIDER_RC",
                "-DNTS_POISON=1",
                "-fsanitize=address,undefined",
                "-fno-sanitize-recover=all",
            ]);
        }
        checked(build.args(["program.ll", "nts_runtime.c", "main.c", "-lm", "-o", "run"]));
        checked(Command::new("timeout").arg("60").arg(scratch.join("run")));
        if !rc {
            assert_presence_mutation(&scratch);
        }
    }
}

#[test]
fn generated_optional_calls_assemble_on_all_six_native_abis() {
    use nts_codegen_llvm::{Arch, Platform};
    let mut program = fixture::program();
    // The ordinary (non-optional) BigInt ABI on Windows ARM is an existing
    // refusal. Its optional make/identity/read/exhausted functions still cover
    // the complete aggregate ABI; keep this unrelated plain-return wrapper out.
    program.funcs.retain(|f| f.name != "roundtripBigInt");
    program
        .public_api
        .retain(|(name, _)| name != "roundtripBigInt");
    let dir = ScratchDir::new(Utf8Path::new(env!("CARGO_TARGET_TMPDIR")), "optional-cross");
    for (triple, platform) in [
        ("x86_64-unknown-linux-gnu", Platform::SYSV_X86_64),
        (
            "x86_64-apple-darwin",
            Platform {
                darwin: true,
                ..Platform::SYSV_X86_64
            },
        ),
        ("x86_64-pc-windows-msvc", Platform::WIN64_X86_64),
        ("aarch64-apple-darwin", Platform::APPLE_ARM64),
        ("aarch64-unknown-linux-gnu", Platform::LINUX_ARM64),
        ("aarch64-pc-windows-msvc", Platform::WINDOWS_ARM64),
    ] {
        let module = nts_codegen_llvm::emit(&program, platform);
        assert!(
            module.diagnostics.is_empty(),
            "{triple}: {:?}",
            module.diagnostics
        );
        let input = dir.join(format!("{triple}.ll"));
        std::fs::write(&input, module.text).expect("LLVM module");
        let mut clang = Command::new("clang");
        clang
            .args(["-target", triple, "-Werror", "-Wno-override-module", "-c"])
            .arg(&input)
            .arg("-o")
            .arg(dir.join(format!("{triple}.o")));
        if platform.arch == Arch::Aarch64 {
            clang.arg("-march=armv8-a");
        }
        checked(&mut clang);
    }
}

fn assert_presence_mutation(dir: &Utf8Path) {
    let original = std::fs::read_to_string(dir.join("program.ll")).expect("emitted LLVM");
    let broken = original.replace("= zext i1 %v0 to i8", "= zext i1 true to i8");
    assert_ne!(
        original, broken,
        "the mutation must change the emitted defined component"
    );
    std::fs::write(dir.join("broken.ll"), broken).expect("mutant LLVM");
    checked(Command::new("clang").current_dir(dir.as_std_path()).args([
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wno-override-module",
        "-O1",
        "broken.ll",
        "nts_runtime.c",
        "main.c",
        "-lm",
        "-o",
        "broken",
    ]));
    let out = Command::new("timeout")
        .arg("60")
        .arg(dir.join("broken"))
        .output()
        .expect("mutated transport");
    assert!(
        out.status.code().is_some_and(|code| code != 0),
        "the independent caller must detect a lost defined component"
    );
}
