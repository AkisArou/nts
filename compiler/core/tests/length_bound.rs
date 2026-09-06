//! The longest array or string, which is one fact in two languages.
//!
//! `hir::facts::MAX_LENGTH` is what the analysis believes and
//! `NTS_MAX_LENGTH` is what the runtime enforces. The compiler's number is only
//! honest **because** the runtime refuses past it — the same shape as the bigint
//! upper endpoint — so the two drifting apart is not a cosmetic problem. A
//! runtime that allowed a longer array than the analysis believes in is a loop
//! counter that wraps, silently, on an input nothing in the test suite is large
//! enough to produce.
//!
//! The headroom the `- 2` exists for is asserted in `hir::facts` itself, at
//! compile time, because it is a property of one constant rather than of the
//! pair. This file is only about the two agreeing.
//!
//! This is the fourth pair of constants this session has needed a check for,
//! after the tag tables, `NtsValue.java`, and the two read-only helper lists.
//! The pattern is the same every time: a fact that cannot live in one place, and
//! nothing comparing the copies.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use nts_core::hir::facts;

#[test]
fn the_analysis_and_the_runtime_agree_on_the_longest_array() {
    let header = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../runtime/c/nts_runtime.h");
    let text = std::fs::read_to_string(header).expect("runtime/c/nts_runtime.h is checked in");
    let line = text
        .lines()
        .find(|line| line.starts_with("#define NTS_MAX_LENGTH"))
        .expect("the header defines `NTS_MAX_LENGTH`");
    let theirs: f64 = line
        .split_whitespace()
        .nth(2)
        .and_then(|value| value.parse().ok())
        .unwrap_or_else(|| panic!("`{line}` does not end in a number"));

    assert!(
        (theirs - facts::MAX_LENGTH).abs() < f64::EPSILON,
        "the runtime refuses past {theirs} and the analysis believes {} -- \
         whichever is larger is the one that is wrong, and if it is the runtime \
         then a loop counter wraps on an array the analysis thought could not exist",
        facts::MAX_LENGTH
    );
}
