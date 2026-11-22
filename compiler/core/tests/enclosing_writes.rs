//! Where an assignment to a name writes, when the builder lowering it holds no
//! binding for the name.
//!
//! An object literal's setter and a local class's method are lowered by
//! builders of their own, with no binding for a local of the function around
//! them. A write to one took a fresh binding of the member's own, which nothing
//! reads, so the store vanished and the caller answered the old value. It now
//! refuses where a read of the same name does, with the read's reason. A first
//! write to the body's own local (`var z; z = n`, or before a hoisted `var`)
//! still takes the fresh binding, which is right for it.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, lower::Lowered};
use nts_frontend_ts::Frontend;

fn lowered(corpus: &str, fixture: &str) -> Lowered {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests")
        .join(corpus)
        .join(fixture)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/{corpus}/{fixture} is checked in"));
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    hir::lower::lower(&snapshot)
}

#[test]
fn a_member_writing_an_enclosing_local_refuses_as_its_read_does() {
    for fixture in [
        "a-literal-setter-writing-an-enclosing-local",
        "a-local-class-method-writing-an-enclosing-local",
    ] {
        let lowered = lowered("refusals", fixture);
        let source = std::fs::read_to_string(
            Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/refusals")
                .join(fixture)
                .join("src/main.ts"),
        )
        .expect("the fixture's source");
        let target =
            u32::try_from(source.find("value = next").expect("the write")).expect("a small source");
        let refused: Vec<_> = lowered
            .diagnostics
            .iter()
            .filter(|diagnostic| {
                diagnostic.code == "NTS1001"
                    && diagnostic
                        .message
                        .contains("`value`, a name from an enclosing scope")
            })
            .collect();
        assert_eq!(
            refused.len(),
            1,
            "{fixture}: the write refuses once, by name: {:?}",
            lowered.diagnostics
        );
        assert_eq!(
            refused[0].primary.span.start, target,
            "{fixture}: at the assignment's target"
        );
    }
}

#[test]
fn a_first_write_to_the_bodys_own_local_still_binds() {
    let lowered = lowered(
        "programs",
        "a-literal-method-writing-an-enclosing-local-is-a-closure",
    );
    assert!(
        lowered.diagnostics.is_empty(),
        "the control compiles whole: {:?}",
        lowered.diagnostics
    );
    for name in ["afterMethod", "afterArrow", "firstWrite", "hoistedWrite"] {
        assert!(
            lowered.program.funcs.iter().any(|func| func.name == name),
            "{name} is compiled"
        );
    }
}
