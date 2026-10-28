//! Execute coupled optional values through generated C and the C ABI. The
//! caller is a separate translation unit, so a matching emitter bug cannot
//! silently redefine both sides of the contract.
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
        let scratch = ScratchDir::new(Utf8Path::new(env!("CARGO_TARGET_TMPDIR")), "optional-c");
        for file in emitted.support_files() {
            let path = scratch.join(file.name);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("support parent");
            }
            std::fs::write(path, file.contents).expect("support file");
        }
        std::fs::write(scratch.join("program.c"), emitted.writer.text()).expect("C");
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
        ]);
        if rc {
            build.args([
                "-DNTS_PROVIDER_RC",
                "-DNTS_POISON=1",
                "-fsanitize=address,undefined",
                "-fno-sanitize-recover=all",
            ]);
        }
        checked(build.args(["program.c", "nts_runtime.c", "main.c", "-lm", "-o", "run"]));
        checked(Command::new("timeout").arg("60").arg(scratch.join("run")));
        if !rc {
            assert_presence_mutation(&scratch, emitted.writer.text());
        }
    }
}

fn assert_presence_mutation(dir: &Utf8Path, source: &str) {
    let original = source;
    let broken = original.replace(".defined = v0", ".defined = !v0");
    assert_ne!(
        original, broken,
        "the mutation must change the emitted defined component"
    );
    std::fs::write(dir.join("broken.c"), broken).expect("mutant C");
    checked(Command::new("clang").current_dir(dir.as_std_path()).args([
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-O1",
        "broken.c",
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
