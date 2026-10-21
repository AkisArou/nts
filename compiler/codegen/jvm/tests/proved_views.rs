//! A typed-array access the middle end proved in range takes the accessor
//! with no test of its own, and one it did not prove keeps the checking one.
//!
//! `tests/programs/a-view-read-guarded-by-its-length-across-a-detaching-call`
//! proves its controls' accesses by a guard on `.length` and leaves checked
//! every read a call can detach or shrink the buffer under. That program's own
//! directory says what it answers on every backend, and its `expect-ir` facts
//! which accesses are proven; this reads the class for the accessor each took.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::{SemanticSource, TsgoApi};
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
fn a_proven_view_access_takes_the_proved_accessor() {
    let tsgo = nts_frontend_ts::tsgo::locate().expect("tsgo is built");
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/programs/a-view-read-guarded-by-its-length-across-a-detaching-call/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
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
        eprintln!("SKIP proved_views: no JDK, so javap has not been asked");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-proved-views-{}", std::process::id()));
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

    let sum = method(&listing, "sumGuarded");
    assert!(
        sum.contains("nts/rt/NtsViewU8.getProved:(Lnts/rt/NtsViewU8;I)I")
            && !sum.contains("nts/rt/NtsViewU8.getInt:"),
        "the proven read went through the checking accessor:\n{sum}"
    );
    let scale = method(&listing, "scaleGuarded");
    assert!(
        scale.contains("nts/rt/NtsViewF64.setProved:(Lnts/rt/NtsViewF64;ID)V")
            && scale.contains("nts/rt/NtsViewF64.getProved:(Lnts/rt/NtsViewF64;I)D")
            && !scale.contains("nts/rt/NtsViewF64.setAt:")
            && !scale.contains("nts/rt/NtsViewF64.getAt:"),
        "a proven access went through the checking accessor:\n{scale}"
    );
    for name in [
        "readAfterACall",
        "readAfterABranch",
        "readAfterAResize",
        "scan",
    ] {
        let body = method(&listing, name);
        assert!(
            body.contains("nts/rt/NtsViewU8.getInt:") && !body.contains("getProved"),
            "`{name}` reads after a call that can move the buffer, unchecked:\n{body}"
        );
    }
    std::fs::remove_dir_all(&dir).unwrap();
}
