//! Constant 32-bit coercions must fold to the values produced by pinned Node.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Func, HirType, OpKind, Terminator, UnOp, ValueId};

#[path = "support/int32_images_cases.rs"]
mod cases;

fn returned_constant(func: &Func, mut value: ValueId) -> Option<f64> {
    for _ in 0..func.values.len() {
        let op = func.value(value);
        match &op.kind {
            OpKind::ConstFloat(number) => return Some(*number),
            OpKind::ConstInt(number) => {
                return i32::try_from(*number)
                    .map(f64::from)
                    .or_else(|_| u32::try_from(*number).map(f64::from))
                    .ok();
            }
            // An int32/uint32 return widened to number preserves its value.
            OpKind::Convert(from)
                if op.ty == (HirType::Float { bits: 64 })
                    && matches!(func.value(*from).ty, HirType::Int { bits: 0..=32, .. }) =>
            {
                value = *from;
            }
            _ => return None,
        }
    }
    None
}

#[test]
fn the_prepared_32_bit_constants_equal_the_node_oracle() {
    let config =
        Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/programs/int32-images/tsconfig.json");
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the scalar edge population typechecks");
    assert!(!snapshot.has_errors());
    for provider in [
        hir::Memory::NoGc,
        hir::Memory::ReferenceCounting,
        hir::Memory::HostGc,
    ] {
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                roots: hir::reachable::Roots::EveryExport,
                ..hir::Options::default()
            },
        )
        .expect("the coercion population prepares");
        for &(name, _, signed, unsigned) in cases::COERCION_CASES {
            for (prefix, expected) in [
                ("signed", f64::from(signed)),
                ("unsigned", f64::from(unsigned)),
            ] {
                let name = format!("{prefix}_{name}");
                let functions: Vec<_> = prepared
                    .program
                    .funcs
                    .iter()
                    .filter(|func| func.name == name || func.name.starts_with(&format!("{name}#")))
                    .collect();
                assert!(
                    !functions.is_empty(),
                    "{name} must survive as an actual export"
                );
                for func in functions {
                    assert!(
                        !func
                            .blocks
                            .iter()
                            .flat_map(|block| &block.ops)
                            .any(|id| matches!(
                                func.value(*id).kind,
                                OpKind::Unary {
                                    op: UnOp::ToInt32 | UnOp::ToUint32,
                                    ..
                                }
                            )),
                        "{name} retains a runtime coercion: {func:?}"
                    );
                    let returns: Vec<_> = func
                        .blocks
                        .iter()
                        .filter_map(|block| match block.terminator {
                            Terminator::Return(Some(value)) => Some(value),
                            _ => None,
                        })
                        .collect();
                    assert!(!returns.is_empty(), "{name} must return a value");
                    for value in returns {
                        let actual = returned_constant(func, value).unwrap_or_else(|| {
                            panic!("{name} did not return a constant: {func:?}")
                        });
                        assert_eq!(
                            actual.to_bits(),
                            expected.to_bits(),
                            "{name} on {provider:?}"
                        );
                    }
                }
            }
        }
    }
}
