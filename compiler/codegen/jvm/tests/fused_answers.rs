//! An erased answer every use reads straight back as a float is never boxed.
//!
//! `tests/programs/an-array-element-read-from-the-end-as-a-number` reads
//! `xs.at(i)!` as a number, where `fuse::fused` (on core's `hir::erased_uses`)
//! sends the call to the scalar `arrayAt`, and reads the same answer through
//! `??`, which tests its tag and keeps `arrayAtValue`. That program's own
//! directory says what it answers on every backend; this reads the class.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::Frontend;
use std::process::Command;

mod common;

/// The bytecode of `name` and every specialization made of it.
fn method(listing: &str, name: &str) -> String {
    let mut body = String::new();
    let mut inside = false;
    for line in listing.lines() {
        if line.starts_with("  ") && !line.starts_with("   ") && line.trim_end().ends_with(");") {
            inside = line.contains(&format!(" {name}(")) || line.contains(&format!(" {name}$"));
        } else if inside {
            body.push_str(line);
            body.push('\n');
        }
    }
    assert!(!body.is_empty(), "no `{name}` in:\n{listing}");
    body
}

#[test]
fn an_answer_read_only_as_a_float_is_never_boxed() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(
            "../../../tests/programs/an-array-element-read-from-the-end-as-a-number/tsconfig.json",
        )
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    let program = common::prepare(&snapshot).expect("valid HIR").program;
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(
        emitted.diagnostics.is_empty(),
        "{:?}",
        emitted
            .diagnostics
            .iter()
            .map(|d| format!("{} {}", d.code, d.message))
            .collect::<Vec<_>>()
    );

    let Some(disassembler) = common::tool("javap") else {
        eprintln!("SKIP fused_answers: no JDK, so javap has not been asked");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-fused-answers-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let listed = Command::new(&disassembler)
        .args(["-c", "-p", "-cp"])
        .arg(&dir)
        .arg("nts.gen.Program")
        .output()
        .unwrap();
    assert!(
        listed.status.success(),
        "{}",
        String::from_utf8_lossy(&listed.stderr)
    );
    let listing = String::from_utf8_lossy(&listed.stdout);
    let scalar = "nts/rt/NtsRuntime.arrayAt:([DD)D";
    let boxing = "nts/rt/NtsRuntime.arrayAtValue:";
    let read = method(&listing, "fromTheEnd");
    assert!(
        read.matches(scalar).count() == 2 && !read.contains(boxing),
        "an answer read only as a float was boxed:\n{read}"
    );
    let tested = method(&listing, "boxed");
    assert!(
        tested.contains(boxing) && !tested.contains(scalar),
        "an answer whose tag is tested lost its box:\n{tested}"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}
