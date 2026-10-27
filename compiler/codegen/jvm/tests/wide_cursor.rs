//! A checked view subscript held in an `i64` is bounded as a `long`.
//!
//! `tests/programs/a-view-written-through-a-wide-cursor`'s `write` stores
//! through a cursor that starts at an `i32` parameter and can pass 2^31, so
//! the cursor is an `i64` -- `utf8Write`'s output position. Narrowing it first
//! would wrap a wide index into range, and the `double` form costs an `l2d`
//! and two floating compares per element, so it takes `bounds(int, long)`.
//! That program's own directory says what it answers on every backend; this
//! reads the class.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::Frontend;

mod common;

#[test]
fn a_wide_view_subscript_is_bounded_as_a_long() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/programs/a-view-written-through-a-wide-cursor/tsconfig.json")
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
        eprintln!("SKIP wide_cursor: no JDK, so javap has not been asked");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-wide-cursor-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let listed = nts_codegen_jvm::toolchain::command(&disassembler)
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
    // `write` and every specialization made of it.
    let mut writes = String::new();
    let mut inside = false;
    for line in listing.lines() {
        if line.starts_with("  ") && !line.starts_with("   ") && line.trim_end().ends_with(");") {
            inside = line.contains(" write(") || line.contains(" write$");
        } else if inside {
            writes.push_str(line);
            writes.push('\n');
        }
    }
    assert!(!writes.is_empty(), "no `write` in:\n{listing}");
    assert!(
        writes.contains("nts/rt/NtsRuntime.bounds:(IJ)I"),
        "the store is not bounded as a long:\n{writes}"
    );
    assert!(
        !writes.contains("nts/rt/NtsRuntime.bounds:(ID)I") && !writes.contains("l2d"),
        "the store's index went through a double:\n{writes}"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}
