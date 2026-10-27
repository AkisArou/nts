//! Signature narrowing removes integer NaN checks, while floating controls keep them.
#![allow(clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BinOp, HirType, OpKind};
use nts_frontend_ts::Frontend;

fn self_comparisons(func: &hir::Func) -> impl Iterator<Item = &HirType> {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter_map(|id| {
            let OpKind::Binary {
                op: BinOp::Eq | BinOp::Ne,
                lhs,
                rhs,
            } = func.values[id.0 as usize].kind
            else {
                return None;
            };
            (lhs == rhs).then_some(&func.values[lhs.0 as usize].ty)
        })
}

#[test]
fn narrowed_call_results_lose_only_the_integer_self_comparisons() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/integer-same-value/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    for provider in [
        hir::Provider::NoGc,
        hir::Provider::ReferenceCounting,
        hir::Provider::HostGc,
    ] {
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::default()
            },
        )
        .expect("prepared HIR verifies");
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        for func in &prepared.program.funcs {
            assert!(
                self_comparisons(func).all(|ty| !matches!(ty, HirType::Int { .. })),
                "{} still compares an integer with itself",
                func.name
            );
        }
        let control = prepared
            .program
            .funcs
            .iter()
            .find(|func| func.name == "floatingNanControl")
            .expect("floating NaN control");
        assert!(
            self_comparisons(control).any(|ty| matches!(ty, HirType::Float { .. })),
            "the floating NaN check must remain"
        );
    }
}
