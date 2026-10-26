//! `o.m?.()` on an optional method erases its receiver to test the receiver's
//! class, and that erase says what a null receiver means, from the source type
//! like every other erase.
//!
//! It said `Impossible` unconditionally, and `this.socket?.uncork?.()` reads a
//! `Corkable | undefined` field whose null pointer is exactly the `undefined`
//! the test has to find no class in. The Wasm backend refused it (54 declines
//! in an-optional-method-called-optionally); C answered right only because it
//! tagged the null an object no class matches. `pokeKnown`, whose receiver
//! cannot be absent, is the control.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Absent, OpKind};
use nts_frontend_ts::Frontend;

fn erases_before_the_class_test(program: &hir::Program, name: &str) -> Vec<Absent> {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("{name} is compiled"));
    func.values
        .iter()
        .filter_map(|op| match op.kind {
            OpKind::InstanceOf { value, .. } => match func.value(value).kind {
                OpKind::Erase { absent, .. } => Some(absent),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

#[test]
fn an_optional_methods_receiver_is_erased_with_its_own_absence() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/optional-method-receiver-absence/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    let lowered = hir::lower::lower_with(&snapshot, &[], &rustc_hash::FxHashMap::default());
    let program = &lowered.program;
    assert_eq!(
        erases_before_the_class_test(program, "Holder#poke"),
        [Absent::Undefined],
        "a `Corkable | undefined` receiver's null is `undefined`"
    );
    assert_eq!(
        erases_before_the_class_test(program, "Holder#pokeKnown"),
        [Absent::Impossible],
        "a receiver typed `Corkable` cannot be absent"
    );
}
