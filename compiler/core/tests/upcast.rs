//! A union of subclasses where their base is wanted.
//!
//! The value is erased — two classes are two representations, so the union
//! carries a tag — and the slot is a pointer to the base. Base-first layout
//! makes that an upcast rather than a conversion, so the tag is read off and
//! discarded. What the tests are about is *which* type comes out: the one the
//! slot wants, not the root of the hierarchy and not the first arm.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType, OpKind};
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

/// The layout name each `Unerase` in a function produces.
fn unerased_to(lowered: &hir::lower::Lowered, name: &str) -> Vec<String> {
    let func = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/upcast"));
    func.values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::Unerase { .. }))
        .filter_map(|op| match &op.ty {
            HirType::Managed(ManagedType::Object(ty)) => lowered
                .program
                .layouts
                .iter()
                .find(|layout| layout.types.contains(ty))
                .map(|layout| layout.name.clone()),
            _ => None,
        })
        .collect()
}

/// A union of subclasses assigned where the base is wanted becomes an unerase
/// to the base.
#[test]
fn a_union_of_subclasses_is_unerased_to_the_base() {
    let Some(lowered) = lowered("upcast") else {
        return;
    };
    assert_eq!(
        lowered
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        Vec::<&str>::new(),
        "nothing in this fixture is refused",
    );

    for name in [
        "throughADeclaration",
        "asAnArgument",
        "threeArms",
        "intoAField",
        "differentDepths",
    ] {
        assert_eq!(
            unerased_to(&lowered, name),
            vec!["Shape".to_owned()],
            "`{name}` upcasts to the base",
        );
    }
}

/// Where one arm *is* the target, nothing is erased in the first place.
///
/// `const shape: Tri = n > 0 ? new Tri(2) : new Small()` with `Small extends
/// Tri`. This was written expecting an unerase to `Tri` and there is none: the
/// declaration's type reaches each arm as its contextual type, so each is
/// upcast on its own — `coerce`'s two-managed-types path, which base-first
/// layout has always made a no-op — and the block parameter is a `Tri *` that
/// no tag was ever attached to.
///
/// That is strictly the better outcome and it is worth pinning, because the
/// obvious "improvement" is to route every union through the new path. Doing so
/// would add an erase and an unerase to a case that currently has neither. The
/// new path is for unions the contextual type does *not* dissolve.
#[test]
fn a_union_the_context_dissolves_is_never_erased_at_all() {
    let Some(lowered) = lowered("upcast") else {
        return;
    };
    assert_eq!(
        unerased_to(&lowered, "toAMiddleClass"),
        Vec::<String>::new(),
        "each arm was upcast on its own, so there was nothing to unerase",
    );
}
