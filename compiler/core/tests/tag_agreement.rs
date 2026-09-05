//! The two tag tables, checked against each other.
//!
//! `hir::tags` opens with "One table on this side of the boundary. The runtime
//! has its own in `nts_runtime.h` — that copy is unavoidable, since C cannot
//! read this one." Two tables, and until this test **nothing checked they held
//! the same numbers.**
//!
//! It is not a theoretical gap. The C backend is immune, because it writes tag
//! *names* into the generated C and the preprocessor resolves them. The LLVM
//! backend writes the **number** from `hir::tags` and links the same runtime,
//! so a disagreement there is a value that reads back as a different type —
//! silently, and only on that lane.
//!
//! Written before renumbering the tags to make room for `symbol`, which is
//! exactly the change that would have found it the hard way.
//!
//! The *orderings* the numbering rests on are asserted in `hir::tags` itself,
//! at compile time, because they are properties of one table rather than of the
//! pair. This file is only about the two tables agreeing.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use nts_core::hir::tags;

/// Every `NTS_TAG_*` the header defines, with the value it defines it as.
fn header_tags() -> Vec<(String, u32)> {
    let header = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../runtime/c/nts_runtime.h");
    let text = std::fs::read_to_string(header).expect("runtime/c/nts_runtime.h is checked in");
    let start = text
        .find("typedef enum NtsTag {")
        .expect("the header declares `enum NtsTag`");
    let end = text[start..]
        .find("} NtsTag;")
        .expect("the enum is terminated")
        + start;

    let mut found = Vec::new();
    for line in text[start..end].lines() {
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        let name = name.trim();
        if !name.starts_with("NTS_TAG_") {
            continue;
        }
        let value = value.trim().trim_end_matches(',').trim();
        found.push((
            name.to_owned(),
            value.parse().expect("a tag is a plain integer"),
        ));
    }
    found
}

/// Each tag has the same number on both sides.
#[test]
fn the_compiler_and_the_runtime_number_the_tags_alike() {
    let header = header_tags();
    assert!(
        header.len() >= 7,
        "the header's tag enum was not parsed: {header:?}"
    );

    let mine: Vec<(&str, u32)> = vec![
        ("NTS_TAG_UNDEFINED", tags::UNDEFINED),
        ("NTS_TAG_BOOLEAN", tags::BOOLEAN),
        ("NTS_TAG_NUMBER", tags::NUMBER),
        ("NTS_TAG_STRING", tags::STRING),
        ("NTS_TAG_FUNCTION", tags::FUNCTION),
        ("NTS_TAG_SYMBOL", tags::SYMBOL),
        ("NTS_TAG_OBJECT", tags::OBJECT),
        ("NTS_TAG_NULL", tags::NULL),
    ];

    for (name, value) in &mine {
        let theirs = header
            .iter()
            .find(|(other, _)| other == name)
            .unwrap_or_else(|| panic!("the header declares no `{name}`"));
        assert_eq!(
            theirs.1, *value,
            "`{name}` is {} in the runtime and {value} in `hir::tags`",
            theirs.1
        );
    }

    // And neither table has a tag the other does not: a runtime tag the
    // compiler cannot name is one no lowering can produce, and a compiler tag
    // the runtime does not know is a value it will not recognise.
    assert_eq!(
        header.len(),
        mine.len(),
        "the header has {} tags and `hir::tags` names {}: {header:?}",
        header.len(),
        mine.len()
    );
}
