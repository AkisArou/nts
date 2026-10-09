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
    let header =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../runtime/c/nts_runtime.h");
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
        ("NTS_TAG_HANDLE_GOBJECT", tags::HANDLE_GOBJECT),
        ("NTS_TAG_HANDLE_OBJC", tags::HANDLE_OBJC),
        ("NTS_TAG_HANDLE_COM", tags::HANDLE_COM),
        ("NTS_TAG_HANDLE_HOST", tags::HANDLE_HOST),
        ("NTS_TAG_BIGINT", tags::BIGINT),
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

/// **Only `OBJECT`, `NULL` and the handles sit in the object band**, because
/// `typeof x === "object"` is emitted as the band test `OBJECT <= tag < end`
/// (`tags::OBJECT_BAND`), and every tag inside it answers `"object"`.
///
/// It was `tag >= OBJECT` until `NTS_TAG_BIGINT` (16) arrived above the handle
/// block: a test with no upper end would have answered `"object"` for a
/// `bigint`. The band's end is what keeps it `"bigint"`.
///
/// The test above catches a tag added to the header alone, by counting. It does
/// not catch one added to **both** tables, which is the shape a real change
/// takes: the counts agree, every name matches, every assertion in `hir::tags`
/// holds, and a value carrying the new tag answers `typeof === "object"`.
///
/// Not hypothetical. On 2026-09-24 the GTK lane proposed `NTS_TAG_NATIVE = 8` to
/// carry a raw C pointer in a promise payload, reasoning correctly that 8 falls
/// outside `NTS_TAG_IS_REFERENCE`'s range (now `NTS_TAG_IS_MANAGED`'s) so retain, release and the tracer skip
/// it. It does, and it would also have made a `GFileInfo *` answer
/// `typeof === "object"` -- and then something would have read it as an
/// `NtsHeader`. A separate slot on `NtsPromise` was taken instead.
///
/// Asserted over the **header's** parsed enum rather than over the list above,
/// so that a tag someone adds to both tables is caught by this file rather than
/// by a program answering the wrong thing.
///
/// The handle block, 8..15, is inside the band on purpose. A C library's object
/// *should* answer `typeof === "object"` -- GJS answers it for a `GObject` --
/// and the worry above, something reading it as an `NtsHeader`, is
/// `NTS_TAG_IS_MANAGED`'s to answer, which the block is outside by construction
/// (`runtime/c/tests/handles.c` checks it).
#[test]
fn only_objects_null_and_handles_answer_typeof_object() {
    let header = header_tags();
    assert!(
        header.len() >= 7,
        "the header's tag enum was not parsed: {header:?}"
    );
    let tags::TagTest::Range { first, end } = tags::OBJECT_BAND else {
        panic!("`typeof x === \"object\"` is a band, not one tag");
    };
    assert_eq!(tags::of_spelling("object"), Some(tags::OBJECT_BAND));
    for (name, value) in &header {
        let an_object = name == "NTS_TAG_OBJECT"
            || name == "NTS_TAG_NULL"
            || (name.starts_with("NTS_TAG_HANDLE_")
                && (tags::HANDLE_BLOCK..tags::HANDLE_BLOCK + tags::HANDLE_BLOCK_SIZE)
                    .contains(value));
        assert_eq!(
            (first..end).contains(value),
            an_object,
            "`{name}` is {value} and the object band is {first}..{end}: a tag inside the band \
             answers \"object\" to `typeof` whatever it holds. A payload that is not an \
             object needs a tag outside it."
        );
    }
    assert_eq!(
        tags::of_spelling("bigint"),
        Some(tags::TagTest::Is(tags::BIGINT))
    );
}
