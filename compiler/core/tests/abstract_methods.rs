//! What an `abstract` method lowers to.
//!
//! It has no body, so the question is why it is lowered at all rather than
//! skipped: the *signature*. A call through `Shape#area` on a `Shape` receiver
//! is an indirect call, and the backend takes the function-pointer type from
//! the declaration — with the method refused, the C emitter said "no
//! declaration for `Shape#area` to take a signature from" and declined the
//! caller.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, Terminator};
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

fn find<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a hir::Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` should be lowered"))
}

/// An abstract method is a signature with no body.
///
/// Both halves are asserted, because each without the other is a different bug.
/// A signature with a *body* would be a placeholder that could be called; a
/// body with no signature is what the refusal produced, and the caller could
/// not be emitted at all.
#[test]
fn an_abstract_method_is_a_signature_terminated_as_unreachable() {
    let Some(lowered) = lowered("abstract-methods") else {
        return;
    };
    let area = find(&lowered, "Shape#area");

    // The receiver, and nothing else: `area()` takes no arguments.
    assert_eq!(area.params.len(), 1, "the receiver: {:?}", area.params);
    assert_eq!(area.return_type, HirType::Float { bits: 64 });

    // One block, no operations, and unreachable. `finish` terminates an open
    // block that way, which is exactly right here rather than a fallback: an
    // abstract class is never instantiated, so this slot is never the one
    // dispatch lands on.
    assert_eq!(area.blocks.len(), 1, "one block: {:?}", area.blocks.len());
    assert!(
        matches!(area.blocks[0].terminator, Terminator::Unreachable),
        "an abstract method's body is unreachable: {:?}",
        area.blocks[0].terminator,
    );
    // And it does nothing but bind its parameters. `Param` is not code — every
    // function has one per argument whether or not the body reads it — so the
    // assertion is that nothing *else* is there. Written as `is_empty()` first,
    // which failed on the receiver.
    let doing: Vec<String> = area.blocks[0]
        .ops
        .iter()
        .map(|op| format!("{:?}", area.values[op.0 as usize].kind))
        .filter(|kind| !kind.starts_with("Param"))
        .collect();
    assert!(doing.is_empty(), "an abstract method has no body: {doing:?}");
}

/// A declaration with parameters carries them, and a non-numeric return type
/// survives too.
///
/// The signature is the whole reason this is lowered, so a test that only
/// checked the zero-argument `number` case would pass with the parameters
/// dropped and the return type guessed.
#[test]
fn an_abstract_declaration_carries_its_whole_signature() {
    let Some(lowered) = lowered("abstract-methods") else {
        return;
    };
    // `abstract scale(by: number, plus: number): number` — receiver and two.
    let scale = find(&lowered, "Scaler#scale");
    assert_eq!(scale.params.len(), 3, "receiver and two: {:?}", scale.params);
    assert_eq!(scale.return_type, HirType::Float { bits: 64 });

    // `abstract label(): string` — a managed return, not a double.
    let label = find(&lowered, "Namer#label");
    assert!(
        matches!(label.return_type, HirType::Managed(_)),
        "a string return survives the declaration: {:?}",
        label.return_type,
    );
}

/// The overrides are what dispatch actually reaches, and they have bodies.
///
/// Without this the previous tests would pass on a lowering that made *every*
/// implementation unreachable.
#[test]
fn the_overrides_have_bodies() {
    let Some(lowered) = lowered("abstract-methods") else {
        return;
    };
    for name in ["Circle#area", "Square#area", "Doubler#scale", "Halver#scale"] {
        let func = find(&lowered, name);
        assert!(
            func.blocks
                .iter()
                .any(|block| !matches!(block.terminator, Terminator::Unreachable)),
            "`{name}` is a real implementation",
        );
    }
    assert_eq!(
        lowered
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.message.contains("abstract"))
            .count(),
        0,
        "nothing in this fixture is refused for being abstract",
    );
}

/// A method with no body that is *not* abstract is still refused.
///
/// Overload signatures are the case, and they are refused *with their
/// implementation* rather than alone. Refusing the signatures by themselves left
/// the implementation lowered and the call sites resolving against whichever
/// signature TypeScript picked — whose parameter list is not the
/// implementation's — and produced invalid HIR from a program every refusal had
/// been reported for. A refusal that leaves a broken artifact is worse than no
/// refusal, because the diagnostics say the compiler noticed.
#[test]
fn an_overloaded_method_is_refused_with_its_implementation() {
    let Some(lowered) = lowered("unsupported") else {
        return;
    };
    let reasons: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    // Three: two signatures and the implementation. All of them, because the
    // implementation surviving is the case that produced invalid HIR.
    let refused = reasons
        .iter()
        .filter(|reason| reason.contains("an overloaded method"))
        .count();
    assert_eq!(
        refused, 3,
        "both signatures and the implementation: {reasons:?}",
    );
}
