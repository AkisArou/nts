//! The generated child table agrees with what nts actually decodes.
//!
//! Every node that has child properties must have exactly as many children
//! filling them (`JSDoc` aside) as its presence mask has bits set, and no bit
//! beyond its kind's table entry. If a tsgo
//! bump changes the encoder and the table is not regenerated, this is what
//! fails. Skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_react::tsgo::{Nodes, children};
use nts_semantic_schema::{NodeData, NodeKind};

fn tsgo() -> Option<Utf8PathBuf> {
    let path = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    path.exists().then_some(path)
}

fn project(relative: &str) -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(relative)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("{relative} is checked in"))
}

fn check(relative: &str, at_least: usize) {
    let Some(tsgo) = tsgo() else {
        return;
    };
    let snapshot = TsgoApi::new(tsgo).snapshot(&project(relative)).expect("snapshot");
    let mut checked = 0usize;
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let (NodeKind::Syntax(kind), NodeData::Children { present, .. }) = (&node.kind, &node.data) else {
            continue;
        };
        let properties = children::properties(*kind);
        assert!(
            properties.len() >= 8 - present.leading_zeros() as usize,
            "node {index} (kind {kind}) has presence bits beyond its {} table properties",
            properties.len(),
        );
        let filled = Nodes::new(&snapshot.nodes).property_children(nts_semantic_schema::NodeId(u32::try_from(index).unwrap())).count();
        assert_eq!(
            present.count_ones() as usize,
            filled,
            "node {index} (kind {kind}): {present:08b} present, {filled} children filling properties",
        );
        checked += 1;
    }
    assert!(checked >= at_least, "only {checked} nodes had children: the program did not load");
}

#[test]
fn the_jsx_example() {
    check("../../../../examples/jsx", 40);
}

#[test]
fn the_react_runtime() {
    check("../../native/probe", 50_000);
}
