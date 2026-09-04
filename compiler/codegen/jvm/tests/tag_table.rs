//! The tag table, which is now written in three places.
//!
//! `compiler/core/src/hir/tags.rs` says of the second one:
//!
//! > One table on this side of the boundary. The runtime has its own in
//! > `nts_runtime.h` — that copy is unavoidable, since C cannot read this one —
//! > but everything in the compiler that needs a tag comes here, so a second
//! > answer cannot appear inside the compiler itself.
//!
//! Java cannot read it either, so `NtsValue.java` is a third. Two of those were
//! held equal by nothing but care, and a third makes that untenable — so this
//! is the check.
//!
//! # Why the values and not just the names
//!
//! The *order* is load-bearing and the numbers are the order. `typeof x ===
//! "object"` is emitted as the single comparison `tag >= OBJECT`, which needs
//! `NULL` adjacent to `OBJECT` because `typeof null` is `"object"`, and needs
//! `FUNCTION` below both because a closure must fall outside the range. A
//! renumbering that kept every name would silently make `typeof` answer
//! `"object"` for a function.
//!
//! Reads the Java *source* rather than the compiled jar, so this runs on a
//! machine with no JDK: what is being checked is a claim two files make about
//! each other, not a property of the artifact.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

fn java_constants() -> Vec<(String, u32)> {
    let source = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../runtime/jvm/src/nts/rt/NtsValue.java"),
    )
    .expect("NtsValue.java");
    source
        .lines()
        .filter_map(|line| {
            let rest = line.trim().strip_prefix("public static final int ")?;
            let (name, value) = rest.split_once(" = ")?;
            let value = value.trim_end_matches(';').trim().parse().ok()?;
            Some((name.trim().to_owned(), value))
        })
        .collect()
}

#[test]
fn the_three_tag_tables_agree() {
    let expected: Vec<(&str, u32)> = vec![
        ("UNDEFINED", nts_core::hir::tags::UNDEFINED),
        ("BOOLEAN", nts_core::hir::tags::BOOLEAN),
        ("NUMBER", nts_core::hir::tags::NUMBER),
        ("STRING", nts_core::hir::tags::STRING),
        ("FUNCTION", nts_core::hir::tags::FUNCTION),
        ("OBJECT", nts_core::hir::tags::OBJECT),
        ("NULL", nts_core::hir::tags::NULL),
    ];
    let found = java_constants();
    assert_eq!(
        found.len(),
        expected.len(),
        "NtsValue.java declares {} tags and hir::tags has {} -- a tag added on \
         one side and not the other is a `typeof` that answers for the wrong \
         kind\nfound: {found:?}",
        found.len(),
        expected.len()
    );
    for (want, got) in expected.iter().zip(&found) {
        assert_eq!(
            (want.0, want.1),
            (got.0.as_str(), got.1),
            "hir::tags and NtsValue.java disagree"
        );
    }
}

#[test]
fn the_ordering_typeof_depends_on_still_holds() {
    // Not a restatement of the table: these are the two facts the *numbering*
    // exists to make true, and either could survive a renumbering that this
    // file's other test would also survive if it only compared names.
    use nts_core::hir::tags;
    assert!(
        tags::NULL > tags::OBJECT,
        "`typeof x === \"object\"` is emitted as `tag >= OBJECT`, so null must \
         be inside that range"
    );
    assert!(
        tags::FUNCTION < tags::OBJECT,
        "a closure must fall outside `tag >= OBJECT`, or `typeof f` answers \
         \"object\""
    );
}
