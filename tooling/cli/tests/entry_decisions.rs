//! Preparation metadata is visible only through its explicit HIR listing flag.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;
use std::process::Command;

fn listing(flags: &[&str]) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let config = root
        .join("tests/programs/a-direct-call-hands-an-argument-to-a-published-method/tsconfig.json");
    let result = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("hir")
        .arg(config)
        .args(flags)
        .args(["--checkers", "1"])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    String::from_utf8(result.stdout).unwrap()
}

#[test]
fn entry_decisions_are_sorted_and_do_not_change_the_unrequested_listing() {
    for flags in [&[][..], &["--prepared"][..], &["--prepared", "--rc"][..]] {
        let ordinary = listing(flags);
        let mut requested = flags.to_vec();
        requested.push("--entry-decisions");
        let observed = listing(&requested);
        let without_decisions: String = observed
            .split_inclusive('\n')
            .filter(|line| !line.starts_with("entry-decision "))
            .collect();
        assert_eq!(
            ordinary, without_decisions,
            "only explicit decision rows can differ"
        );
        assert!(!ordinary.contains("entry-decision "));
        if !flags.contains(&"--rc") {
            continue;
        }
        let rows: Vec<serde_json::Value> = observed
            .lines()
            .filter_map(|line| line.strip_prefix("entry-decision "))
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let names: Vec<_> = rows
            .iter()
            .map(|row| row["function"].as_str().unwrap())
            .collect();
        assert_ne!(names, [] as [&str; 0]);
        assert!(names.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(
            names.len(),
            observed
                .lines()
                .filter(|line| line.starts_with("func ")
                    || line.starts_with("export func ")
                    || line.starts_with("declare func "))
                .count()
        );
        let slot_names: Vec<_> = names
            .iter()
            .copied()
            .filter(|name| name.starts_with("@slots:"))
            .collect();
        assert_eq!(
            slot_names,
            [
                "@slots:Sink#keep#whole:0.0",
                "@slots:Sink#keep@raises#whole:0.0",
            ]
        );
        for name in slot_names {
            let row = rows.iter().find(|row| row["function"] == name).unwrap();
            assert_eq!(
                row["decision"], "excluded",
                "a private slot body has no separate borrowed arrival"
            );
        }
        assert!(
            rows.iter()
                .any(|row| row["function"] == "publish" && row["decision"] == "selected")
        );
    }
    let help = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("help")
        .output()
        .unwrap();
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("--entry-decisions"));
}
