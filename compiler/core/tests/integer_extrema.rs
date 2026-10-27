//! Answers alone pass with the old double cursors too: assert the proved
//! integer selection, while observing the signs of both zeroes in the controls.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, BinOp, HirType, OpKind};
use nts_frontend_ts::Frontend;

fn extrema(func: &hir::Func) -> impl Iterator<Item = &hir::Op> {
    func.values.iter().filter(|op| {
        matches!(
            op.kind,
            OpKind::Binary {
                op: BinOp::Min | BinOp::Max,
                ..
            }
        )
    })
}

#[test]
fn only_proved_integer_extrema_specialize_without_narrowing_their_operands() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/integer-extrema/tsconfig.json")
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
        let get = |name: &str| {
            prepared
                .program
                .funcs
                .iter()
                .find(|f| f.name == name)
                .expect(name)
        };
        for name in ["integerClamp", "mergePositions", "signedMinimumRemainder"] {
            let ops: Vec<_> = extrema(get(name)).collect();
            assert!(!ops.is_empty(), "{name}: must exercise a selection");
            for op in ops {
                assert!(matches!(op.ty, HirType::Int { .. }), "{name}: {op:?}");
            }
        }
        for name in [
            "fractionalClamp",
            "minZeroReciprocal",
            "minZeroIs",
            "maxZeroReciprocal",
            "maxZeroIs",
            "negativeZeroMaximumIs",
        ] {
            let ops: Vec<_> = extrema(get(name)).collect();
            assert!(
                !ops.is_empty(),
                "{name}: must exercise the floating control"
            );
            assert!(
                ops.iter().all(|op| matches!(op.ty, HirType::Float { .. })),
                "{name}: zero sign and fractions must survive"
            );
        }
        for name in ["clampUnsigned", "mixedMaximum"] {
            let ops: Vec<_> = extrema(get(name)).collect();
            assert!(!ops.is_empty(), "{name}: full-width input control");
            for op in ops {
                assert_eq!(
                    op.ty,
                    HirType::Int {
                        bits: 64,
                        signed: true
                    },
                    "{name}: selection must hold both operands"
                );
            }
        }
    }
}
