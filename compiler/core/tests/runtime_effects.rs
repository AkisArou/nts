//! Runtime effects are complete and independent of scalar ABI normalization.

use nts_core::hir::runtime::{self, Raising};
use std::collections::BTreeSet;

fn function_names(ast: &str) -> BTreeSet<String> {
    ast.lines()
        .filter(|line| line.contains("FunctionDecl "))
        .filter_map(|line| line.split(" '").next()?.split_whitespace().last())
        .filter(|name| name.starts_with("nts_"))
        .map(str::to_owned)
        .collect()
}

#[test]
fn every_header_helper_has_an_explicit_raising_contract() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = std::process::Command::new("clang")
        .args([
            "-std=c11",
            "-Xclang",
            "-ast-dump",
            "-fsyntax-only",
            "-x",
            "c",
        ])
        .arg(root.join("runtime/c/nts_runtime.h"))
        .output()
        .expect("clang is required to validate runtime effects");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let names = function_names(&String::from_utf8_lossy(&output.stdout));
    assert!(names.len() > 400, "the complete header must be inspected");
    for name in names {
        assert!(
            runtime::raising(&name).is_some(),
            "unclassified helper {name}"
        );
    }
    let names: Vec<_> = runtime::helper_names().collect();
    assert!(names.windows(2).all(|pair| pair[0] < pair[1]));
}

#[test]
fn effects_do_not_extend_the_scalar_conversion_view() {
    assert_eq!(runtime::raising("nts_region_begin"), Some(Raising::NoRaise));
    assert!(runtime::parameters("nts_region_begin").is_none());
    assert!(runtime::parameters("nts_str_append").is_some());
    assert!(runtime::raising("foreign_callback_without_a_contract").is_none());
}

#[test]
fn process_ending_helpers_are_distinct_from_language_raises() {
    for name in ["nts_refused", "nts_assertion_failed", "nts_uncaught"] {
        assert_eq!(runtime::raising(name), Some(Raising::Diverges), "{name}");
    }
    for name in ["nts_raise", "nts_value_to_string", "nts_array_to_string"] {
        assert_eq!(runtime::raising(name), Some(Raising::MayRaise), "{name}");
    }
    for name in [
        "nts_str_append",
        "nts_array_push_ref",
        "nts_str_append_char_at",
        "nts_str_append_number",
        "nts_str_concat_grown",
        "nts_map_set",
        "nts_region_end_call",
    ] {
        assert_eq!(runtime::raising(name), Some(Raising::NoRaise), "{name}");
    }
}
