//! Constructor argument expansion must stay well formed for every provider.
#![allow(clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Memory};
use nts_frontend_ts::Frontend;

#[test]
fn the_constructor_contract_prepares_for_every_provider() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/array-constructor-overloads/tsconfig.json")
        .canonicalize_utf8()
        .expect("the contract fixture is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the fixture captures");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    for provider in [Memory::NoGc, Memory::ReferenceCounting, Memory::HostGc] {
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::default()
            },
        )
        .expect("every provider must receive valid constructor HIR");
        assert!(
            prepared.diagnostics.is_empty(),
            "{provider:?}: {:?}",
            prepared.diagnostics
        );
    }
}
