//! `Program::signature_faces`: a written signature's **typed** parameter list,
//! published because a backend never sees the snapshot.
//!
//! The JVM gives a signature class a Java-callable face — `implements
//! NtsNumberCallback`, a concrete `call(double)`, a `$Lambda` so a Java lambda can
//! be passed — and that surface was keyed on the typed `call` slot that A6
//! deleted. It vanished silently, leaving a published Java API Java cannot call,
//! and six weeks passed before a full gate ran `interop`. This is the fact it
//! needs, kept where nothing that decides a representation reads it.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered() -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/signature-faces/tsconfig.json")
        .canonicalize_utf8()
        .expect("the fixture is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

/// Each face by the name the hierarchy gave its layout, with each position
/// spelled as `Some`/`None` so the two meanings are visible in one string.
fn faces(lowered: &hir::lower::Lowered) -> Vec<(String, String)> {
    let mut rows: Vec<(String, String)> = lowered
        .program
        .signature_faces
        .iter()
        .map(|(ty, face)| {
            let name = lowered
                .program
                .layouts
                .iter()
                .find(|layout| layout.types.contains(ty))
                .map_or_else(|| format!("{ty:?}"), |layout| layout.name.clone());
            let params: Vec<String> = face
                .params
                .iter()
                .map(|part| match &part.ty {
                    Some(ty) => format!("{ty:?}"),
                    None => "None".to_owned(),
                })
                .collect();
            (name, params.join(", "))
        })
        .collect();
    rows.sort();
    rows
}

/// **The anti-skip arm.** A test that returns early without `tsgo` reports `ok`,
/// and a filler that produced an empty map would pass every assertion below on an
/// empty collection — which is the shape of the failure this whole field exists
/// to stop. So the first thing checked is that the pass ran at all.
#[test]
fn the_fixture_lowered_and_the_map_is_not_empty() {
    let Some(lowered) = lowered() else {
        return;
    };
    assert!(
        !lowered.program.funcs.is_empty(),
        "the fixture lowered nothing, so nothing below is a test"
    );
    assert!(
        !lowered.program.signature_faces.is_empty(),
        "no signature face at all, though the fixture writes two signatures: {:?}",
        faces(&lowered)
    );
}

#[test]
fn a_written_signature_has_every_position_typed() {
    let Some(lowered) = lowered() else {
        return;
    };
    let rows = faces(&lowered);
    let weigh = lowered.program.signature_faces.values().find(|face| {
        face.params.len() == 2
            && face.params.iter().all(|part| part.ty.is_some())
            && face.returns.is_some()
    });
    assert!(
        weigh.is_some(),
        "no face with two typed parameters and a typed return, for `Weigh`: {rows:?}"
    );
}

/// A position with no representation is `None` **in place**, not a shorter list
/// and not an absent entry: the consumer must be able to publish the erased face
/// for that one parameter and keep the typed face for the others.
#[test]
fn a_position_with_no_representation_is_none_in_place() {
    let Some(lowered) = lowered() else {
        return;
    };
    let rows = faces(&lowered);
    let mixed = lowered
        .program
        .signature_faces
        .values()
        .find(|face| face.params.iter().any(|part| part.ty.is_none()));
    let Some(mixed) = mixed else {
        panic!("no face carries a `None` position, though `Mixed` takes a symbol: {rows:?}");
    };
    assert_eq!(
        mixed.params.len(),
        2,
        "the untypeable position was dropped rather than recorded: {rows:?}"
    );
    assert!(
        mixed.params.iter().any(|part| part.ty.is_some()),
        "the whole face was abandoned for one untypeable position: {rows:?}"
    );
}

/// `optional` and `rest` are the declaration's and not invented.
///
/// The fixture writes neither, so the only honest assertion is that neither is
/// reported. A version of this that claimed to *find* an optional parameter would
/// be asserting the fixture rather than the field — and the first draft of it
/// carried an `|| true` alongside, a check whose answer did not depend on its
/// input, which is no check at all.
#[test]
fn no_optional_or_rest_is_invented() {
    let Some(lowered) = lowered() else {
        return;
    };
    assert!(
        !lowered.program.signature_faces.is_empty(),
        "nothing to check, which would make this pass vacuously"
    );
    assert!(
        lowered
            .program
            .signature_faces
            .values()
            .all(|face| face.params.iter().all(|part| !part.optional && !part.rest)),
        "an optional or rest flag was reported where the fixture declares none: {:?}",
        faces(&lowered)
    );
}
