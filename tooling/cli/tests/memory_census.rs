//! The public census route produces JSON and names unavailable host-GC facts.
#![allow(clippy::unwrap_used)]
use std::path::Path;
use std::process::Command;

#[test]
fn census_is_json_and_host_gc_is_not_an_empty_graph() {
    let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/memory/traversal");
    let run = |flags: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_nts"))
            .args(["regions", "--census", "--no-acquire", "--checkers", "1"])
            .args(flags)
            .arg(&project)
            .output()
            .unwrap()
    };
    let output = run(&["--rc"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["census"]["schema"], 1);
    assert_ne!(
        json["census"]["sites"].as_array().unwrap().as_slice(),
        [] as [serde_json::Value; 0]
    );
    assert_ne!(
        json["sources"].as_array().unwrap().as_slice(),
        [] as [serde_json::Value; 0]
    );
    let unavailable = run(&["--backend", "jvm"]);
    assert!(!unavailable.status.success());
    assert_eq!(unavailable.stdout, [] as [u8; 0]);
    assert!(
        String::from_utf8_lossy(&unavailable.stderr)
            .contains("memory census is unavailable for the host-GC provider")
    );
}
