//! Binding tags and bigint literals must enter the same exact HIR value.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "../../test-support/scratch.rs"]
mod scratch;

use camino::Utf8Path;
use nts_core::hir::{self, HirType, OpKind};
use nts_frontend_ts::Frontend;
use scratch::ScratchDir;

fn snapshot(name: &str, source: &str) -> nts_semantic_schema::SemanticSnapshot {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/native-bigint-constants"), name);
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","{root}/runtime/native/scalars.d.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    snapshot
}

fn lower(name: &str, source: &str) -> hir::lower::Lowered {
    hir::lower::lower(&snapshot(name, source))
}

#[test]
fn a_binding_bigint_constant_keeps_every_bit() {
    for (tag, value) in [
        ("9007199254740993", 9_007_199_254_740_993),
        ("-9007199254740993", -9_007_199_254_740_993),
        ("9223372036854775807", i128::from(i64::MAX)),
        ("-9223372036854775808", i128::from(i64::MIN)),
        ("18446744073709551615", i128::from(u64::MAX)),
        ("0x20000000000001", 9_007_199_254_740_993),
    ] {
        let lowered = lower(
            tag,
            &format!(
                "/** @ntsConstant {tag} */\ndeclare const VALUE: bigint;\n\
                 export function tagged(): bigint {{ return VALUE; }}\n\
                 export function control(): bigint {{ return {value}n; }}\n"
            ),
        );
        assert!(lowered.diagnostics.is_empty(), "{:?}", lowered.diagnostics);
        for name in ["tagged", "control"] {
            let func = lowered
                .program
                .funcs
                .iter()
                .find(|f| f.name == name)
                .unwrap();
            // Source syntax lowers a negative literal as unary minus; the
            // binding tag already contains the signed integer.
            let literal = if name == "control" {
                value.abs()
            } else {
                value
            };
            assert!(
                func.values.iter().any(|op| op.ty == HirType::BigInt
                    && matches!(op.kind, OpKind::ConstInt(found) if found == literal)),
                "{tag} / {name}: {func:?}"
            );
            assert!(
                !func
                    .values
                    .iter()
                    .any(|op| matches!(op.kind, OpKind::ConstFloat(_)))
            );
        }
    }
}

#[test]
fn a_binding_bigint_constant_refuses_nonintegers_and_overflow() {
    for text in [
        "1.5",
        "1e3",
        "NaN",
        "170141183460469231731687303715884105728",
        "-170141183460469231731687303715884105729",
    ] {
        let lowered = lower(
            "refused",
            &format!(
                "/** @ntsConstant {text} */\ndeclare const VALUE: bigint;\n\
                 export function tagged(): bigint {{ return VALUE; }}\n\
                 export function control(): bigint {{ return 1n; }}\n"
            ),
        );
        assert!(
            lowered
                .diagnostics
                .iter()
                .any(|d| d.code == "NTS1001"
                    && d.message.contains("an exact integer fitting 128 bits")),
            "{text}: {:?}",
            lowered.diagnostics
        );
        assert!(lowered.program.funcs.iter().any(|f| f.name == "control"));
        assert!(!lowered.program.funcs.iter().any(|f| f.name == "tagged"));
    }
}

#[test]
fn a_binding_bigint_constant_still_obeys_the_c_stores_domain() {
    for (kind, accepted, refused) in [
        ("BigInt64", "-9223372036854775808", "-9223372036854775809"),
        ("BigInt64", "9223372036854775807", "9223372036854775808"),
        ("BigUint64", "0", "-1"),
        ("BigUint64", "18446744073709551615", "18446744073709551616"),
    ] {
        for (tag, must_refuse) in [(accepted, false), (refused, true)] {
            let read = snapshot(
                "c-domain",
                &format!(
                    "import type {{ {kind} }} from \"@nts/scalars\";\n\
                 declare function accept(value: {kind}): void;\n\
                 /** @ntsConstant {tag} */\ndeclare const VALUE: bigint;\n\
                 export function run(): void {{ accept(VALUE); }}\n"
                ),
            );
            let diagnostics = match hir::prepare(&read) {
                Ok(prepared) => prepared.diagnostics,
                Err(hir::Unprepared::Rejected(errors)) => errors,
                Err(invalid) => panic!("{}", invalid.render(&read.sources)),
            };
            if must_refuse {
                assert!(
                    diagnostics.iter().any(|d| d.code == "NTS5001"),
                    "{kind} / {tag}: {diagnostics:?}"
                );
            } else {
                assert!(diagnostics.is_empty(), "{kind} / {tag}: {diagnostics:?}");
            }
        }
    }
}
