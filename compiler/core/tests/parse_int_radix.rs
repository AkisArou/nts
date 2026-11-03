//! The parser receives an integer radix. Primitive conversion belongs to the
//! shared lowering, where constants and already-int32 values can avoid it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, OpKind, UnOp};

fn snapshot() -> nts_semantic_schema::SemanticSnapshot {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/parse-int-radix/tsconfig.json");
    let result = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("the radix population typechecks");
    assert!(!result.has_errors());
    result
}

fn live(func: &hir::Func) -> impl Iterator<Item = &OpKind> {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .map(|id| &func.value(*id).kind)
}

fn radix(func: &hir::Func) -> hir::ValueId {
    live(func)
        .find_map(|op| match op {
            OpKind::Call {
                callee: hir::Callee::External(name),
                args,
                ..
            } if name == "nts_parse_int" => Some(args[1]),
            _ => None,
        })
        .expect("the actual parser call remains live")
}

#[test]
fn a_dynamic_radix_uses_the_shared_to_int32_before_the_parser() {
    let snapshot = snapshot();
    let lowered = hir::lower::lower(&snapshot);
    assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
    let func = lowered
        .program
        .funcs
        .iter()
        .find(|f| f.name == "dynamic")
        .unwrap();
    assert!(matches!(
        func.value(radix(func)).kind,
        OpKind::Unary {
            op: UnOp::ToInt32,
            ..
        }
    ));
}

#[test]
fn constants_fold_and_the_prepared_parser_abi_is_int32() {
    let snapshot = snapshot();
    for provider in [
        hir::Memory::NoGc,
        hir::Memory::ReferenceCounting,
        hir::Memory::HostGc,
    ] {
        let options = hir::Options {
            provider,
            roots: hir::reachable::Roots::EveryExport,
            ..hir::Options::default()
        };
        let prepared = hir::prepare_with(&snapshot, &options).expect("valid prepared radix HIR");
        for (name, constant, conversions) in [
            ("literal", Some(10), 0),
            ("omitted", Some(0), 0),
            ("explicitUndefined", Some(0), 0),
            ("wrappedConstant", Some(16), 0),
            ("provedInt32", None, 1),
            ("dynamic", None, 1),
        ] {
            let funcs: Vec<_> = prepared
                .program
                .funcs
                .iter()
                .filter(|f| f.name == name || f.name.starts_with(&format!("{name}#")))
                .collect();
            assert!(!funcs.is_empty(), "{name} must survive preparation");
            for func in funcs {
                let argument = func.value(radix(func));
                assert_eq!(
                    argument.ty,
                    HirType::Int {
                        bits: 32,
                        signed: true
                    },
                    "{name}"
                );
                if let Some(expected) = constant {
                    assert!(
                        matches!(argument.kind, OpKind::ConstInt(value) if value == expected),
                        "{name}: {argument:?}"
                    );
                }
                assert_eq!(
                    live(func)
                        .filter(|op| matches!(
                            op,
                            OpKind::Unary {
                                op: UnOp::ToInt32,
                                ..
                            }
                        ))
                        .count(),
                    conversions,
                    "{name} retains no redundant conversion"
                );
            }
        }
    }
}
