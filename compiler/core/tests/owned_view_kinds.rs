//! Which typed-array kinds own their buffers (`hir::views`). One case per way a

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType};
use nts_frontend_ts::Frontend;

#[test]
fn a_kind_is_owned_until_something_reaches_its_bytes() {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/owned-view-kinds/tsconfig.json")
        .canonicalize_utf8()
        .expect("the program is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    let program = hir::prepare(&snapshot).expect("valid HIR").program;
    let owned = hir::views::owned_view_kinds(&program);
    let int = |bits, signed| HirType::Int { bits, signed };
    let f64 = HirType::Float { bits: 64 };
    let f32 = HirType::Float { bits: 32 };
    // Allocated by its constructor, read through a `subarray` window, and
    // handed to a parameter of its own type.
    assert!(owned.contains(&f64), "{owned:?}");
    // Over an ArrayBuffer nothing else touches.
    assert!(owned.contains(&int(32, true)), "{owned:?}");
    // `.buffer` read.
    assert!(!owned.contains(&int(16, false)), "{owned:?}");
    // Two kinds over one buffer.
    assert!(!owned.contains(&f32), "{owned:?}");
    assert!(!owned.contains(&int(8, false)), "{owned:?}");
    // Erased.
    assert!(!owned.contains(&int(32, false)), "{owned:?}");
    // Passed where an ArrayBufferView is wanted.
    assert!(!owned.contains(&int(8, true)), "{owned:?}");
}
