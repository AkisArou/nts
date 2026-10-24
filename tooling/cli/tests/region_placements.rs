//! The report names a source site without claiming an unimplemented proof.
#![allow(clippy::unwrap_used)]
use std::process::Command;

#[test]
fn regions_explains_unanalysed_storage_at_its_source() {
    if std::env::var_os("NTS_TSGO").is_none() {
        eprintln!("SKIP regions placement report: set NTS_TSGO");
        return;
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .current_dir(root)
        .args([
            "regions",
            "tests/programs/calls-a-region-could-serve",
            "--rc",
            "--no-acquire",
        ])
        .output()
        .unwrap();
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(
        output.status.success(),
        "{text}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(text.contains("allocation/storage candidate(s)"), "{text}");
    let sites: Vec<_> = text
        .lines()
        .filter(|line| line.starts_with("placement "))
        .collect();
    assert_ne!(sites, [] as [&str; 0], "{text}");
    assert!(
        sites
            .iter()
            .all(|line| line.ends_with("owner unselected; Unknown(not analysed)")),
        "{text}"
    );
    assert!(
        sites.iter().any(|line| line.contains("object @ ")
            && line.contains("calls-a-region-could-serve/src/main.ts:")),
        "{text}"
    );
}
