//! `readonly` belongs to a property of a type, and was twice asked of
//! something shared.
//!
//! Both defects had the same shape and neither was a missing feature: they were
//! a fact about one declaration read off a structure that several declarations
//! share.
//!
//! - The frontend decided it by searching **the whole program** for any node
//!   carrying the modifier with a child of that text. One `readonly count`
//!   anywhere made every `count` everywhere readonly.
//! - The lowering then read the flag off the **layout**, which every type of
//!   the same shape shares — and `same_shape` deliberately ignores `readonly`,
//!   correctly, because storage does not depend on who may write.
//!
//! Together they refused twenty-four legal assignments in `runtime/node`, on
//! `length`, `destroyed`, `closed`, `chunks`, `port`, `resolve`, `finished`,
//! `root`, `name` and `path` — every name common enough that something,
//! somewhere, declares it readonly.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, ManagedType, OpKind};
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
        .unwrap_or_else(|| panic!("`{name}` is exported from examples/readonly-names"))
}

/// A property is not readonly because something else of that name is.
///
/// The fixture is built so every writable property shares its name with a
/// readonly one declared beside it. Nothing here may be refused.
#[test]
fn readonly_does_not_leak_between_unrelated_types() {
    let Some(lowered) = lowered("readonly-names") else {
        return;
    };
    assert_eq!(
        lowered
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        Vec::<&str>::new(),
        "every assignment in this fixture is legal TypeScript",
    );
    for name in [
        "writesTheMutableOne",
        "bothAtOnce",
        "theUnrelatedSizeIsWritable",
        "writesLength",
        "throughAMethod",
    ] {
        let writes = func(&lowered, name)
            .values
            .iter()
            .filter(|op| matches!(op.kind, OpKind::FieldSet { .. }))
            .count();
        assert!(writes > 0, "`{name}` writes a field");
    }
}

/// And the two types whose names collide really do share one layout.
///
/// Without this the test above passes for the wrong reason: if `Frozen` and
/// `Counter` were laid out separately, reading `readonly` off the layout would
/// give the right answer by accident and the second defect would be invisible.
///
/// `same_shape` ignores `readonly` on purpose — two identical arrangements of
/// bytes are one descriptor whoever may write to them — so this is a property
/// of the design rather than an accident, and it is exactly why writability
/// cannot be asked of a layout.
#[test]
fn the_frozen_and_writable_classes_share_a_layout() {
    let Some(lowered) = lowered("readonly-names") else {
        return;
    };
    let of = |func_name: &str| -> Vec<usize> {
        func(&lowered, func_name)
            .values
            .iter()
            .filter_map(|op| match &op.ty {
                hir::HirType::Managed(ManagedType::Object(ty)) => lowered
                    .program
                    .layouts
                    .iter()
                    .position(|layout| layout.types.contains(ty)),
                _ => None,
            })
            .collect()
    };
    let frozen = of("readsTheFrozenOne");
    let counter = of("writesTheMutableOne");
    assert!(!frozen.is_empty() && !counter.is_empty(), "both allocate");
    assert!(
        frozen.iter().any(|at| counter.contains(at)),
        "`Frozen` and `Counter` have identical fields and share a layout: \
         frozen {frozen:?}, counter {counter:?}",
    );
}

/// An inherited `readonly` is still readonly.
///
/// The half a naive fix breaks. Asking the *type* rather than the name is right
/// only if an inherited property answers for its base's declaration, which it
/// does because the property's symbol is the base's — and a fix that asked the
/// derived class's own member list instead would lose it.
#[test]
fn an_inherited_readonly_property_is_still_readonly() {
    let Some(lowered) = lowered("readonly-names") else {
        return;
    };
    // `FrozenChild` inherits `readonly size` and declares a writable `extra`,
    // and the example reads both without writing either outside a constructor.
    // What is checked here is that the snapshot still says so, which is the
    // input the lowering's decision is made from.
    let inherited = func(&lowered, "inheritedReadonlyStillReads");
    let reads = inherited
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::FieldGet { .. }))
        .count();
    assert!(reads >= 2, "it reads the inherited field and the own one");
}
