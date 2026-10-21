//! A string key that cannot be absent reaches a table unboxed, and one that
//! may be absent keeps its box.
//!
//! `tests/programs/a-record-keyed-by-strings-built-at-run-time` stores and
//! reads under built and literal keys, and its control keys a `Map` by
//! `string | undefined`. That program's own directory says what it answers on
//! every backend; this reads the class for the door each lookup took
//! (`fuse::unboxed_keys`).

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
    // Prepared as the JVM build prepares it, for the host's heap: a native
    // preparation shares a table's lookups (`hir::entries`), which this
    // backend's tables do not answer.
    let program = nts_core::hir::prepare_with(
        &snapshot,
        &nts_core::hir::Options {
            provider: nts_codegen_common::provider::host_gc("jvm", false).unwrap(),
            ..nts_core::hir::Options::default()
        },
    )
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
    // `pick` may be undefined, so its erasure says so and the key keeps its
    // box, which `undefined` and "undefined" need to stay two keys. Counted,
    // not found: the literal `undefined` key is boxed whatever the rule does,
    // so one boxed `set` is there either way. Boxed, the literal `undefined`
    // and `pick` -- a `set` and a `get` each; through the doors, the literal
    // "undefined" once each. A rule that unboxed `pick` moves one of each.
    let control = method(&listing, "undefinedKeys");
    let count = |call: &str| control.matches(call).count();
    let counts = (
        count(
            "nts/rt/NtsMap.set:(Lnts/rt/NtsMap;Lnts/rt/NtsValue;Lnts/rt/NtsValue;)Lnts/rt/NtsMap;",
        ),
        count("nts/rt/NtsTable.get:(Lnts/rt/NtsTable;Lnts/rt/NtsValue;)Lnts/rt/NtsValue;"),
        count("nts/rt/NtsMap.setString:"),
        count("nts/rt/NtsMap.getString:"),
    );
    assert_eq!(
        counts,
        (2, 2, 1, 1),
        "boxed set, boxed get, setString, getString in `undefinedKeys`:\n{control}"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}
