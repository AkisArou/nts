//! A missing override stops by name while all remaining inputs still run.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::process::Command;

#[test]
fn every_layout_slot_names_one_prepared_definition() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../compiler/core/tests/programs/refused-virtual-slots/runtime.json");
    let listing = |args: &[&str]| {
        let result = Command::new(env!("CARGO_BIN_EXE_nts"))
            .arg(args[0])
            .arg(&fixture)
            .args(&args[1..])
            .env_remove("NTS_RC")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8(result.stdout).unwrap()
    };
    let hir = listing(&["hir", "--prepared", "--backend", "c"]);
    let layouts = listing(&["layouts"]);
    let mut definitions = std::collections::BTreeMap::new();
    for line in hir.lines() {
        let line = line.strip_prefix("export ").unwrap_or(line);
        let line = line.strip_prefix("declare ").unwrap_or(line);
        if let Some((name, _)) = line.strip_prefix("func ").and_then(|s| s.split_once('(')) {
            *definitions.entry(name).or_insert(0) += 1;
        }
    }
    let slots: Vec<_> = layouts
        .lines()
        .filter_map(|line| line.strip_prefix("  methods "))
        .collect();
    assert!(slots.iter().any(|name| name.starts_with("nts$refused$")));
    assert!(
        slots.contains(&"Compiled#value"),
        "the compiled control must remain"
    );
    for name in slots {
        assert_eq!(
            definitions.get(name),
            Some(&1),
            "slot {name:?} must name one complete definition\n{layouts}\n{hir}"
        );
    }
}

#[test]
fn a_refused_fewer_parameter_override_keeps_its_jvm_dispatch_abi() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../compiler/core/tests/programs/refused-virtual-slot-arity/tsconfig.json");
    let result = Command::new(env!("CARGO_BIN_EXE_nts"))
        .arg("check")
        .arg(fixture)
        .env("NTS_BACKEND", "jvm")
        .env_remove("NTS_RC")
        .env_remove("NTS_KEEP_TEMP")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&result.stdout);
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(!result.status.success(), "a refused input must stop");
    assert!(
        stdout.contains("checked 57 of 58 cases"),
        "{stdout}\n{stderr}"
    );
    assert!(
        stdout.contains("`RefusedNarrow#read` was refused:"),
        "{stdout}\n{stderr}"
    );
    assert!(stderr.contains("aborted 1 time(s)"), "{stdout}\n{stderr}");
    assert!(
        !stdout.contains("  nts  ") && !stdout.contains("  node "),
        "{stdout}\n{stderr}"
    );
}

#[test]
fn refused_virtual_receivers_stop_on_every_backend_and_controls_finish() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../compiler/core/tests/programs/refused-virtual-slots/runtime.json");
    let scratch = std::env::temp_dir().join(format!("nts-refused-slot-{}", std::process::id()));
    std::fs::create_dir_all(&scratch).unwrap();
    for backend in ["c", "llvm", "jvm"] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_nts"));
        command
            .arg("check")
            .arg(&fixture)
            .env("NTS_BACKEND", backend)
            .env_remove("NTS_RC")
            .env_remove("NTS_KEEP_TEMP");
        let result = command.output().unwrap();
        let stdout = String::from_utf8_lossy(&result.stdout);
        let stderr = String::from_utf8_lossy(&result.stderr);
        assert!(
            stdout.contains("3 case(s) the compiled program declined"),
            "{backend}: {stdout}\n{stderr}"
        );
        assert!(
            stdout.contains("checked 113 of 116 cases"),
            "{backend}: {stdout}\n{stderr}"
        );
        assert!(
            !stdout.contains("  nts  ") && !stdout.contains("  node "),
            "{backend}: controls must agree: {stdout}\n{stderr}"
        );
        assert!(
            !result.status.success(),
            "{backend}: a missing feature must stop: {stdout}\n{stderr}"
        );
        assert!(
            stderr.contains("aborted 3 time(s)"),
            "{backend}: {stdout}\n{stderr}"
        );
        assert_eq!(stdout.matches("the compiled program aborted: nts: refused at run time: `Refused#value` was refused: `eval` is never provided: it evaluates source text, and a program compiled ahead of time carries no evaluator").count(), 3, "{backend}: {stdout}\n{stderr}");
    }
    std::fs::remove_dir_all(scratch).unwrap();
}
