//! The gate's cargo tests also execute the conformance input-root contracts.

use std::path::Path;
use std::process::Command;

#[test]
fn content_addressed_case_roots_obey_their_contracts() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repository");
    let output = Command::new("node")
        .args(["--test", "tooling/census/project.test.ts"])
        .current_dir(repo)
        .output()
        .expect("node must be installed for the conformance runner");
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
