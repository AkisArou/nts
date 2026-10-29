//! Membership is established at erased assertions and never inferred from a
//! declared target. Backend callers execute the same fixture independently.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::Frontend;
#[path = "../../test-support/scratch.rs"]
mod scratch;

#[test]
fn erased_literal_checks_survive_and_typed_claims_remain_unchecked() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/literal-assertions"), "core");
    std::fs::write(
        dir.join("main.ts"),
        include_str!("../../codegen/common/test-support/literal-assertions/main.ts"),
    )
    .unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    for name in [
        "numberClaim",
        "stringClaim",
        "stringUnionClaim",
        "finalized",
        "unionClaim",
        "enumClaim",
        "enumMemberClaim",
        "anyClaim",
        "recoveredErasure",
        "mixedClaim",
        "nullableClaim",
        "bigintClaim",
        "booleanClaim",
        "zeroClaim",
    ] {
        let function = prepared
            .program
            .funcs
            .iter()
            .find(|f| f.name == name)
            .expect(name);
        assert!(function.blocks.iter().flat_map(|b| &b.ops).any(|value| matches!(&function.values[value.0 as usize].kind, OpKind::ConstString(message) if message.as_utf8() == Some("The asserted literal or enum value does not match the value"))), "{name} needs a caught membership failure");
    }
    for name in ["typedNumber", "typedUnion", "typedEnum", "typedString"] {
        let function = prepared
            .program
            .funcs
            .iter()
            .find(|f| f.name == name)
            .expect(name);
        assert!(!function.blocks.iter().flat_map(|b| &b.ops).any(|value| matches!(&function.values[value.0 as usize].kind, OpKind::Call { callee: Callee::External(name), .. } if ["nts_raise", "nts_assertion_failed"].contains(&name.as_str()))), "{name} is a typed claim and must add no runtime check");
    }
}
