//! The semantic child slots agree with native syntax capture.
//!
//! Every node that has child properties must have exactly as many children
//! filling them (`JSDoc` aside) as its presence mask has bits set, and no bit
//! beyond its kind's table entry. Native role drift fails the frontend's
//! exhaustive projection test before any consumer can silently lose a child.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::Frontend;
use nts_react::syntax::Nodes;
use nts_semantic_schema::{NodeData, NodeKind, children};

fn project(relative: &str) -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("{relative} is checked in"))
}

fn check(relative: &str, at_least: usize) {
    let mut checked = 0usize;
    Frontend::new(env!("CARGO_MANIFEST_DIR")).with_checkers(std::num::NonZeroU16::MIN)
        .inspect(&project(relative), |file, _| -> Result<_, nts_semantic_schema::SnapshotError> {
        for (index, node) in file.tree.nodes.iter().enumerate() {
        let NodeKind::Syntax(kind) = node.kind else { continue; };
        let properties = children::properties(kind);
        if properties.is_empty() { continue; }
        // A node with all optional slots absent now carries flags only. It
        // still exercises its kind's semantic child layout with a zero mask.
        let present = match node.data {
            NodeData::Children { present, .. } => present,
            NodeData::Flags { .. } => 0,
            NodeData::ListLength(_) => panic!("a syntax node cannot be a list"),
        };
        assert!(
            properties.len() >= 8 - present.leading_zeros() as usize,
            "node {index} (kind {kind}) has presence bits beyond its {} table properties",
            properties.len(),
        );
        let filled = Nodes::new(&file.tree.nodes)
            .property_children(nts_semantic_schema::NodeId(u32::try_from(index).unwrap()))
            .count();
        assert_eq!(
            present.count_ones() as usize,
            filled,
            "node {index} (kind {kind}): {present:08b} present, {filled} children filling properties",
        );
        checked += 1;
    }
            Ok(())
        }).expect("native syntax capture");
    assert!(
        checked >= at_least,
        "only {checked} nodes had children: the program did not load"
    );
}

#[test]
fn the_jsx_example() {
    // Childless syntax tokens now use Flags. This floor counts only kinds
    // with semantic child properties; the old wire-payload count included tokens.
    check("../../../../tests/programs/jsx", 30);
}

#[test]
fn the_react_runtime() {
    check("../../native/probe", 50_000);
}
