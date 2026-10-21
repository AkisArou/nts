//! A string key that cannot be absent reaches a table unboxed.
//!
//! `tests/programs/a-record-keyed-by-strings-built-at-run-time` stores and
//! reads under built and literal keys. That program's own directory says what
//! it answers on every backend; this reads the class for the door each lookup
//! took (`fuse::unboxed_keys`).
//!
//! The control -- a key that may be absent keeps its box -- has no program yet:
//! lowering erases a `string | undefined` as though it could not be absent
//! (tests/outcomes/a-map-key-that-may-be-absent-erased-as-a-string), so the
//! rule is asked about an absent key by `body.rs`'s unit test instead.

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
fn a_string_key_that_cannot_be_absent_is_passed_unboxed() {
    let tsgo = nts_frontend_ts::tsgo::locate().expect("tsgo is built");
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/programs/a-record-keyed-by-strings-built-at-run-time/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    let program = nts_core::hir::prepare(&snapshot)
        .expect("valid HIR")
        .program;
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
        eprintln!("SKIP string_keys: no JDK, so javap has not been asked");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-string-keys-{}", std::process::id()));
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

    for name in ["countBuilt", "countLiteral", "tally"] {
        let body = method(&listing, name);
        assert!(
            body.contains("nts/rt/NtsMap.getString:(Lnts/rt/NtsTable;Ljava/lang/String;)Lnts/rt/NtsValue;")
                && body.contains(
                    "nts/rt/NtsMap.setString:(Lnts/rt/NtsMap;Ljava/lang/String;Lnts/rt/NtsValue;)Lnts/rt/NtsMap;"
                )
                && !body.contains("nts/rt/NtsValue.ofString:"),
            "`{name}` built a box for a key it could pass unboxed:\n{body}"
        );
    }
    assert!(
        method(&listing, "tally")
            .contains("nts/rt/NtsMap.hasString:(Lnts/rt/NtsTable;Ljava/lang/String;)Z"),
        "`tally`'s `has` took its key boxed"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}
