//! A separately compiled Java caller crosses the exported erased boundary.
//! Mismatches must reach a `TypeError` handler, including mixed literal unions.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_frontend_ts::Frontend;
use std::process::Command;
mod common;
#[path = "../../../test-support/scratch.rs"]
mod scratch;

fn checked(command: &mut Command) -> Vec<u8> {
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{command:?}: {:?}\n{}\n{}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn erased_literal_membership_is_checked_from_a_foreign_caller() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/literal-assertions"), "jvm");
    std::fs::write(
        dir.join("main.ts"),
        include_str!("../../common/test-support/literal-assertions/main.ts"),
    )
    .unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = common::prepare(&snapshot).unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, &class.bytes).unwrap();
    }
    let jar = dir.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    let classpath = format!("{dir}:{jar}", dir = &*dir);
    std::fs::write(
        dir.join("Drive.java"),
        include_str!("../../common/test-support/literal-assertions/Drive.java"),
    )
    .unwrap();
    checked(
        nts_codegen_jvm::toolchain::command(common::tool("javac").expect("JDK required"))
            .args(["-cp", &classpath, "-d"])
            .arg(&*dir)
            .arg(dir.join("Drive.java")),
    );
    assert_eq!(
        checked(
            nts_codegen_jvm::toolchain::command(common::tool("java").expect("JDK required"))
                .args(["-Xverify:all", "-cp", &classpath, "Drive"])
        ),
        b"130 cases\n"
    );
}
