//! `Array.from`, which is the walk with an append where the body would be.
//!
//! Everything a `for...of` can iterate arrives here for nothing — an array, a
//! typed array, a string by code point, a `Map` or `Set`, a user type with
//! `[Symbol.iterator]`, and a generator — because it is the same
//! `walk_of` both ask.
//!
//! What the tests are about is the two decisions that are *not* the walk: which
//! source keeps a `slice`, and which sources know their length before they
//! start. Both were measured, and both were got wrong first.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

fn func<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a hir::Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/array-from"))
}

fn externals(func: &hir::Func) -> Vec<&str> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::External(name),
                ..
            } => Some(name.as_str()),
            _ => None,
        })
        .collect()
}

/// An array source keeps its `slice`, and it is one call rather than a loop.
///
/// The general walk is correct for an array and costs more than copying one:
/// `Array.from(array)` over 256 elements, two thousand times, measured
/// **1.05 ms** walking against **782 us** slicing. A `slice` is a memcpy of one
/// run of memory whose length is known before it starts; the walk is a bounds
/// check, a load and a store per element.
///
/// So this is one specialization with a number on it, and the test is that it
/// is still taken.
#[test]
fn an_array_source_is_a_slice() {
    let Some(lowered) = lowered("array-from") else {
        return;
    };
    let from_array = func(&lowered, "fromArray");
    assert!(
        externals(from_array).contains(&"nts_array_slice"),
        "an array source copies rather than walks: {:?}",
        externals(from_array),
    );
    assert_eq!(
        from_array.blocks.len(),
        1,
        "and it is one block, so there is no loop in it",
    );
}

/// A **typed** array source is not sliced, and this is a regression test.
///
/// `Uint8Array` is `ManagedType::Array` too, so a fast path spelled
/// `Array(_)` takes it — and `slice` moves eight bytes or a word where a
/// `Uint8Array` holds one, so `lower_array_copy` refuses it by name. That is
/// exactly what happened: widening the guard to "an array" turned a working
/// `Array.from(u8)` into `a copy of a typed array is not supported`, an hour
/// after the walk had made it work.
///
/// The guard is the two element widths `slice` reads, and the test asks for the
/// typed source specifically rather than for "an array".
#[test]
fn a_typed_array_source_walks_instead() {
    let Some(lowered) = lowered("array-from") else {
        return;
    };
    let from_typed = func(&lowered, "fromTyped");
    assert!(
        !externals(from_typed).contains(&"nts_array_slice"),
        "a typed array cannot be sliced: {:?}",
        externals(from_typed),
    );
    assert!(
        from_typed.blocks.len() > 1,
        "so it is the walk, which is a loop",
    );
}

/// A source that knows how many elements are coming allocates once.
///
/// A table keeps its live entry count in the header field an array uses for
/// `length`, so `Array.from(set)` can size the result before it starts and fill
/// it by index. Appending instead grows it by doubling.
///
/// **The timing does not see this**: 2.66 ms appending against 2.70 ms sized,
/// which is no change. The allocation count does — nine against five for a
/// sixteen-element walk, and `tooling/memory/cases/array-from` is where that is
/// held. Two instruments, one of which is blind to it.
#[test]
fn a_counted_source_is_sized_before_the_walk() {
    let Some(lowered) = lowered("array-from") else {
        return;
    };
    let from_set = func(&lowered, "fromSet");
    let sized = from_set.values.iter().any(|op| match op.kind {
        OpKind::ArrayNew { length, .. } => {
            matches!(from_set.values[length.0 as usize].kind, OpKind::Length(_))
        }
        _ => false,
    });
    assert!(sized, "the result is allocated at the table's own size");
    assert!(
        !externals(from_set).contains(&"nts_array_push"),
        "and filled by index rather than appended: {:?}",
        externals(from_set),
    );
}

/// A source that does **not** know its length appends, and a string is one.
///
/// `"a\u{1F600}b"` is three code points and its `length` is four, so sizing the
/// result from the string's length would allocate one slot too many and leave
/// a zero in it. A generator is the other: its elements do not exist until it
/// is asked for them.
///
/// This is the half a naive "always size it" breaks, and it breaks it into a
/// *wrong answer* rather than an error — the extra slot is a legal element.
#[test]
fn a_source_of_unknown_length_appends() {
    let Some(lowered) = lowered("array-from") else {
        return;
    };
    for name in ["fromString", "fromGenerator"] {
        let walk = func(&lowered, name);
        assert!(
            externals(walk)
                .iter()
                .any(|call| call.starts_with("nts_array_push")),
            "`{name}` cannot know its length, so it appends: {:?}",
            externals(walk),
        );
    }
}

/// The two-argument form is refused by name, and it is two features.
///
/// With an iterable it is `map` fused into the walk; with `{ length: n }` it is
/// not an iteration at all — an array-like is read by index, and
/// `Array.from({ length: 4 })` builds four `undefined`s from an object with no
/// elements. Both are in `runtime/node` and neither is this.
#[test]
fn the_two_argument_form_is_refused_by_name() {
    let Some(lowered) = lowered("array-from-unsupported") else {
        return;
    };
    let said: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    assert!(
        said.contains(
            &"an `Array.from` with a mapping callback, or over an array-like is not supported \
              by this lowering yet"
        ),
        "{said:#?}",
    );
}
