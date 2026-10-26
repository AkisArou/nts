//! Compile-time constant folding.
//!

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_frontend_ts::Frontend;
use nts_semantic_schema::syntax;
use nts_semantic_schema::{ConstantValue, NodeKind, SemanticSnapshot};

fn snapshot() -> SemanticSnapshot {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/programs/classes/tsconfig.json")
        .canonicalize_utf8()
        .expect("tests/programs/classes fixture is checked in");
    Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed")
}

/// The folded value of the enum member named `name`, if any.
fn member_value(snapshot: &SemanticSnapshot, name: &str) -> Option<ConstantValue> {
    snapshot
        .nodes
        .iter()
        .enumerate()
        .find(|(_, node)| {
            node.kind == NodeKind::Syntax(syntax::ENUM_MEMBER)
                && node.children.iter().any(|c| {
                    snapshot.nodes[c.0 as usize]
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        == Some(name)
                })
        })
        .and_then(|(index, _)| {
            snapshot
                .constants
                .get(&nts_semantic_schema::NodeId(u32::try_from(index).unwrap()))
                .cloned()
        })
}

#[test]
fn numeric_enum_members_fold_to_their_values() {
    let snapshot = snapshot();
    assert_eq!(
        member_value(&snapshot, "Red"),
        Some(ConstantValue::Number(1.0))
    );
    assert_eq!(
        member_value(&snapshot, "Green"),
        Some(ConstantValue::Number(2.0))
    );
    assert_eq!(
        member_value(&snapshot, "Blue"),
        Some(ConstantValue::Number(4.0))
    );
}

#[test]
fn string_enum_members_fold_to_their_values() {
    let snapshot = snapshot();
    assert_eq!(
        member_value(&snapshot, "Fast"),
        Some(ConstantValue::String("fast".into()))
    );
}

#[test]
fn a_const_enum_read_folds_because_it_has_to() {
    let snapshot = snapshot();
    // `Mode` is a `const enum`: the object does not exist at runtime, so a backend
    // that emitted a property load would be reading a member of nothing. This is
    // the one folding case that is a correctness requirement rather than an
    // optimization.
    let folded_reads: Vec<&ConstantValue> = snapshot
        .constants
        .iter()
        .filter(|(node, _)| {
            snapshot.nodes[node.0 as usize].kind
                == NodeKind::Syntax(syntax::PROPERTY_ACCESS_EXPRESSION)
        })
        .map(|(_, value)| value)
        .collect();

    assert_eq!(
        folded_reads,
        vec![&ConstantValue::String("fast".into())],
        "`Mode.Fast` must fold",
    );
}

#[test]
fn a_regular_enum_read_is_not_folded_by_the_checker() {
    let snapshot = snapshot();
    // Documents a real limit rather than a bug. `Color` is an ordinary enum, so it
    // has a runtime object and TypeScript deliberately emits a property access —
    // preserving reverse mapping (`Color[1] === "Red"`) and the object's identity.
    // `getConstantValue` reflects that and returns nothing for `Color.Red`.
    //
    // The member values ARE known (see the tests above), so this compiler can fold
    // such reads itself once it decides whether the enum object is observable. That
    // is a lowering decision, not a checker one, and is deliberately not made here.
    let color_reads = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| {
            node.kind == NodeKind::Syntax(syntax::PROPERTY_ACCESS_EXPRESSION)
                && node.children.iter().any(|c| {
                    snapshot.nodes[c.0 as usize]
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        == Some("Color")
                })
        })
        .count();
    assert!(color_reads >= 2, "the fixture reads `Color` twice");

    assert!(
        !snapshot.constants.iter().any(|(node, _)| {
            snapshot.nodes[node.0 as usize].children.iter().any(|c| {
                snapshot.nodes[c.0 as usize]
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    == Some("Color")
            })
        }),
        "a regular enum read folded; the checker's behaviour changed",
    );
}

#[test]
fn an_ordinary_property_access_folds_to_nothing() {
    let snapshot = snapshot();
    // `this.radius` is not constant. Folding it would be a wrong immediate, which
    // is worse than a load.
    assert!(
        !snapshot.constants.iter().any(|(node, _)| {
            snapshot.nodes[node.0 as usize].children.iter().any(|c| {
                snapshot.nodes[c.0 as usize]
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    == Some("radius")
            })
        }),
        "a non-constant property access was folded",
    );
}
