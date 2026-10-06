//! Copies must retain behavioral roots and use binding/position evidence.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn closed_erased_calls_keep_every_root_and_independent_parameter_positions() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/a-closed-call-recovers-an-erased-parameter/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let lowered = hir::lower::lower(&snapshot);
    for name in ["fixed", "forwards", "aliased", "recurses"] {
        assert!(
            lowered.program.funcs.iter().any(|func| {
                func.name.starts_with(&format!("{name}@0ef64"))
                    && func.params[0].ty == HirType::NUMBER
            }),
            "no number copy of {name}: {:?}",
            lowered.diagnostics
        );
    }
    assert!(
        lowered.program.funcs.iter().any(|func| {
            func.name.starts_with("unknownEquality@0ef64") && func.params[0].ty == HirType::NUMBER
        }),
        "unknown shares the producer proof with any"
    );
    let mixed = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name.starts_with("mixed@"))
        .expect("a mixed copy");
    assert_eq!(mixed.params[0].ty, HirType::Managed(ManagedType::String));
    assert_eq!(
        mixed.params[1].ty,
        HirType::Erased,
        "the same any type does not merge positions"
    );
    let other = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name.starts_with("otherPosition@"))
        .expect("the second-position copy");
    assert_eq!(other.params[0].ty, HirType::Erased);
    assert_eq!(other.params[1].ty, HirType::NUMBER);
    let prepared = hir::prepare(&snapshot).expect("valid HIR");
    for name in [
        "aNumber",
        "aString",
        "forwarding",
        "constantAliases",
        "recursion",
        "independentPositions",
        "evaluatedOnce",
        "aLiteralAlias",
        "anOrdinaryEntryStillWorks",
        "numericOperators",
        "aStringUsedNumerically",
        "aPartlyErasedComparison",
        "differentPrimitives",
        "narrowingKeepsItsOrdinaryEntry",
        "aCopyBelowTry",
        "aBuiltinThrowBelowTry",
        "anUnknownProducer",
        "recoveredStringOrdering",
    ] {
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|func| func.name == name && func.exported),
            "missing {name}: {:?}",
            prepared.diagnostics
        );
    }
}

#[test]
fn escape_mutation_unknown_edges_casts_and_spreads_do_not_prove_a_copy() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/erased-copies-boundaries/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let lowered = hir::lower::lower(&snapshot);
    for name in [
        "returned",
        "stored",
        "forwardedToStorage",
        "mutable",
        "mutableAlias",
        "captured",
        "unresolved",
        "unresolvedForwarder",
        "selected",
        "sequenced",
        "defaulted",
        "escaped",
        "exported",
        "reexported",
        "asserted",
        "assertedAlias",
        "spreadPosition",
        "hasThis",
        "powered",
        "againstBigInt",
        "againstBigIntAlias",
        "forwardsToBigInt",
        "nullableObject",
        "nullableResult",
        "nullableString",
        "nullableAlias",
        "readCompared",
        "readConcatenated",
        "readOfStrings",
    ] {
        assert!(
            !lowered
                .program
                .funcs
                .iter()
                .any(|func| func.name.starts_with(&format!("{name}@"))),
            "{name} received a copy without a closed use and producer proof"
        );
        assert!(
            !lowered
                .program
                .uncompiled
                .iter()
                .any(|(entry, _)| entry.starts_with(&format!("{name}@"))),
            "{name} offered a refused copy without a closed use and producer proof"
        );
    }
    assert!(
        !lowered
            .program
            .funcs
            .iter()
            .any(|func| func.name.starts_with("uncarried@") && func.name.ends_with("@raises")),
        "a specialized receiver cannot prove an unrelated callback carries exceptions"
    );
    let copies: Vec<_> = lowered
        .program
        .funcs
        .iter()
        .filter(|func| func.name.starts_with("bounded@") && !func.name.ends_with("@raises"))
        .collect();
    let offered: std::collections::BTreeSet<_> = copies
        .iter()
        .map(|func| func.name.as_str())
        .chain(
            lowered
                .program
                .uncompiled
                .iter()
                .filter(|(name, _)| name.starts_with("bounded@") && !name.ends_with("@raises"))
                .map(|(name, _)| name.as_str()),
        )
        .collect();
    assert_eq!(
        offered.len(),
        8,
        "one source copy per representation, capped before the ninth"
    );
    assert!(copies.iter().all(|func| !func.exported));
}

/// A copy that took an array reads an element through `nts_array_element`
/// and `ToNumber`, never a trapping load: the checker typed the read `any`,
/// past the end it is `undefined`, and every consumer the copy was admitted
/// for reads that as NaN. The example's answers cannot show a trap -- the
/// checker counts an abort as a declined case -- so this asserts the read.
#[test]
fn a_recovered_array_reads_past_its_end_as_nan() {
    let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/a-closed-call-recovers-an-erased-object-parameter/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).expect("valid HIR");
    let copy = prepared
        .program
        .funcs
        .iter()
        .find(|func| func.name.starts_with("pastTheEnd@"))
        .expect("an array copy of pastTheEnd");
    assert!(
        matches!(&copy.params[0].ty, HirType::Managed(ManagedType::Array(element)) if **element == HirType::NUMBER),
        "{:?}",
        copy.params[0].ty
    );
    let scheduled = || copy.blocks.iter().flat_map(|block| &block.ops).map(|value| &copy.values[value.0 as usize].kind);
    let calls = |helper: &str| {
        scheduled().any(|kind| matches!(kind, hir::OpKind::Call { callee: hir::Callee::External(name), .. } if name == helper))
    };
    assert!(calls("nts_array_element") && calls("nts_value_to_number"), "the read is not answered");
    assert!(
        !scheduled().any(|kind| matches!(kind, hir::OpKind::ArrayGet { checked: true, .. })),
        "a checked load traps where node answers undefined"
    );
}
