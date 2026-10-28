//! The census must execute the real provider, not count source annotations.
use std::path::Path;
use std::process::Command;

fn run(project: &str, flags: &[&str]) -> std::process::Output {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("contents-census")
        .arg(root.join(project).join("tsconfig.json"))
        .args(flags)
        .env("NTS_CHECKERS", "1")
        .output()
        .expect("running the content census")
}

#[test]
fn real_writers_prove_scalar_values_and_keep_wider_managed_writes_dynamic() {
    let output = run(
        "tests/programs/container-content-facts",
        &["--rc", "--backend", "c"],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("one complete JSON report");
    let rows = value["rows"].as_array().expect("allocation rows");
    assert_ne!(rows.len(), 0);
    // This writer receives an unconstrained number parameter. Its annotation
    // proves no integer range; the coupled provider correctly keeps F64.
    assert!(rows.iter().any(|r| {
        r["function"]
            .as_str()
            .is_some_and(|n| n.contains("closedNumber"))
            && r["value_eligibility"] == "F64"
    }));
    let wider: Vec<_> = rows
        .iter()
        .filter(|r| {
            r["function"]
                .as_str()
                .is_some_and(|n| n.contains("managedThroughWide"))
        })
        .collect();
    assert!(
        !wider.is_empty(),
        "the wider-alias control must be measured"
    );
    assert!(wider.iter().all(|r| r["value_eligibility"] == "Dynamic"));
    assert_eq!(value["state"], "PASS");
}

#[test]
fn an_invalid_input_or_wrong_provider_cannot_look_measured() {
    for (project, flags) in [
        ("tests/programs/invalid", &["--rc"][..]),
        ("tests/programs/container-content-facts", &[][..]),
    ] {
        let output = run(project, flags);
        assert!(!output.status.success());
        assert!(serde_json::from_slice::<serde_json::Value>(&output.stdout).is_err());
    }
}
