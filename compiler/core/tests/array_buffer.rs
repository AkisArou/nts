//! `ArrayBuffer`: the rules the runtime cannot enforce.
//!
//! Every one of these is a check the *lowering* owns, because the runtime has
//! no way to throw — a handler is a block and a `throw` is a jump this pass
//! emits. So a helper that quietly returned something for a bad length would
//! agree with node on nothing and be visible in no answer at all.
//!
//! The two that matter most are the ones that were wrong first. `ToIndex` is
//! two rules — truncate toward zero, *then* range-check — and comparing before
//! truncating rejected three shapes node accepts. Truncation alone was not
//! enough either: `trunc(NaN)` is NaN, every comparison with NaN is false, and
//! the `RangeError` for `new ArrayBuffer(1, { maxByteLength: NaN })` simply did
//! not happen.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, ManagedType, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered() -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/array-buffer/tsconfig.json")
        .canonicalize_utf8()
        .expect("examples/array-buffer is checked in");
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
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/array-buffer"))
}

fn calls(func: &hir::Func) -> Vec<String> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::External(name) | Callee::Direct(name),
                ..
            } => Some(name.clone()),
            _ => None,
        })
        .collect()
}

/// An `ArrayBuffer` is its own managed type, not an object with a layout.
#[test]
fn a_buffer_is_a_managed_type_of_its_own() {
    let Some(lowered) = lowered() else {
        return;
    };
    let made = func(&lowered, "length");
    assert!(
        made.values
            .iter()
            .any(|op| matches!(op.ty, hir::HirType::Managed(ManagedType::Buffer))),
        "`new ArrayBuffer(n)` produces a `ManagedType::Buffer`",
    );
}

/// The length is compared as a `ToIndex` value, not as what was written.
///
/// This is the assertion that would have caught both bugs. Against the raw
/// arguments, `new ArrayBuffer(0, { maxByteLength: -0.5 })` threw where node
/// answers zero, because `0 > -0.5`; against truncated ones, `maxByteLength:
/// NaN` stopped throwing where node throws, because nothing compares true with
/// NaN. One helper decides both, and it is the same helper that decides how
/// many bytes are allocated — so the size and the check cannot drift apart.
#[test]
fn the_maximum_is_compared_after_conversion_to_an_index() {
    let Some(lowered) = lowered() else {
        return;
    };
    let growable = func(&lowered, "growableMaximum");
    let names = calls(growable);
    assert!(
        names.iter().filter(|name| *name == "nts_to_index").count() >= 2,
        "both the length and the maximum are converted before being compared: {names:?}",
    );
    assert!(
        names.iter().any(|name| name == "nts_buffer_new_resizable"),
        "and a maximum makes it the resizable constructor: {names:?}",
    );
}

/// A length the machine cannot give is an answer, not an abort.
///
/// The runtime returns null where `calloc` fails, because node raises a
/// `RangeError` there — and a *different* one from the length check, since
/// "Invalid array buffer length" is what the language refuses and "Array
/// buffer allocation failed" is what this machine could not do. Without the
/// check the program aborted on signal 6, which the differential reports as a
/// crash rather than a disagreement.
#[test]
fn an_allocation_that_fails_is_checked_rather_than_trusted() {
    let Some(lowered) = lowered() else {
        return;
    };
    let made = func(&lowered, "length");
    assert!(
        made.values
            .iter()
            .any(|op| matches!(op.kind, OpKind::ConstNull)),
        "the constructor's result is compared against null",
    );
}

/// `transfer` and `transferToFixedLength` differ, and the difference is passed.
///
/// They are one runtime helper and a flag. A lowering that wired both to the
/// same call would keep the resizable state in both cases and pass every test
/// that only looked at one of them.
#[test]
fn the_two_transfers_are_told_apart_by_a_constant_this_lowering_supplies() {
    let Some(lowered) = lowered() else {
        return;
    };
    let keeps = func(&lowered, "transferKeepsResizable");
    let drops = func(&lowered, "fixedTransferDropsResizable");
    let flag = |func: &hir::Func| {
        func.values
            .iter()
            .filter_map(|op| match op.kind {
                OpKind::ConstBool(value) => Some(value),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    assert!(
        flag(keeps).contains(&false),
        "`transfer` passes false: {:?}",
        flag(keeps)
    );
    assert!(
        flag(drops).contains(&true),
        "`transferToFixedLength` passes true: {:?}",
        flag(drops)
    );
}

/// A fixed buffer and a bad length are different refusals.
///
/// Node distinguishes them and a program can tell which it got: `resize` on a
/// fixed buffer is a `TypeError` about the receiver, and a length past the
/// maximum is a `RangeError` about the length. Wiring both to one class would
/// pass any test that only caught *that it threw*.
#[test]
fn a_wrong_receiver_and_a_wrong_length_are_told_apart() {
    let Some(lowered) = lowered() else {
        return;
    };
    let text = |func: &hir::Func| {
        func.values
            .iter()
            .filter_map(|op| match &op.kind {
                OpKind::ConstString(value) => Some(value.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    let fixed = text(func(&lowered, "resizeFixed"));
    assert!(
        fixed
            .iter()
            .any(|message| message.contains("incompatible receiver")),
        "a fixed buffer refuses `resize` as a receiver problem: {fixed:?}",
    );
    let resized = text(func(&lowered, "resized"));
    assert!(
        resized
            .iter()
            .any(|message| message.contains("Invalid length parameter")),
        "and a length past the maximum is a length problem: {resized:?}",
    );
}

/// The two constructor messages are not the same sentence.
///
/// `new ArrayBuffer(-1)` says "Invalid array buffer length" and
/// `new ArrayBuffer(0, { maxByteLength: -1 })` says "Invalid array buffer max
/// length" -- and `new ArrayBuffer(8, { maxByteLength: 4 })` says the *max*
/// message even though the length is what is out of range. A single shared
/// message would agree with node on the class and disagree on the text.
#[test]
fn the_length_and_the_maximum_have_their_own_sentences() {
    let Some(lowered) = lowered() else {
        return;
    };
    let growable = func(&lowered, "growableMaximum");
    let messages: Vec<String> = growable
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::ConstString(value) => Some(value.clone()),
            _ => None,
        })
        .collect();
    assert!(
        messages
            .iter()
            .any(|message| message == "Invalid array buffer length"),
        "the length keeps its own message: {messages:?}",
    );
    assert!(
        messages
            .iter()
            .any(|message| message == "Invalid array buffer max length"),
        "and the maximum has a different one: {messages:?}",
    );
}
