//! A no-raise helper must not reach the C pending-raise producer.

use nts_core::hir::runtime::{self, Raising};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::process::Stdio;

#[path = "runtime_effects/graph.rs"]
mod graph;
use graph::Graph;

/// These are protocol callbacks, not a claim about arbitrary function pointers.
/// Memory/host hooks have the non-raising contract in `nts_runtime.h`; task,
/// printer and synchronous pump hooks may enter language code.
fn callback_raises(owner: &str, target: &str) -> Option<bool> {
    match (owner, target) {
        ("nts_value_to_string", "to_string")
        | ("nts_process_ticks_and_rejections" | "nts_task_run", "run")
        | ("nts_callback_call", "methods")
        | ("nts_promise_join", "pump_one") => Some(true),
        ("nts_free_storage", "free")
        | ("nts_each_erased_slot", "each")
        | ("nts_visit_managed", "visit")
        | ("nts_each_holder", "node" | "visit")
        | ("nts_each_reference", "each_held" | "trace_fields" | "visit")
        | ("nts_release_contents", "release_fields")
        | ("nts_collect_pass", "sever")
        | ("nts_collect_at_checkpoint", "fallen")
        | ("nts_callback_leave", "returns_to_loop")
        | (
            "nts_array_at_counted"
            | "nts_value_retain"
            | "nts_array_fill_counted"
            | "nts_array_slice_counted"
            | "nts_array_extend_counted"
            | "nts_array_concat_counted"
            | "nts_array_from_handles",
            "retain",
        )
        | (
            "nts_call_foreign_release" | "nts_array_fill_counted" | "nts_array_set_length_counted",
            "release",
        )
        | ("nts_hash_key", "nts_objc_key_hash")
        | ("nts_key_eq", "nts_objc_key_equal")
        | ("nts_enqueue_microtask", "enqueue_microtask")
        | ("nts_pending_begin" | "nts_pending_end", "pending")
        | ("nts_is_owner_thread", "is_owner_thread")
        | ("nts_post_task", "post_task")
        | ("nts_post_delayed", "post_delayed")
        | ("nts_cancel_delayed", "cancel_delayed")
        | ("nts_post_from_any_thread", "post_from_any_thread") => Some(false),
        _ => None,
    }
}

#[test]
fn no_raise_contracts_cannot_reach_the_c_raise_producer() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let output = std::process::Command::new("clang")
        .args([
            "-std=c11",
            "-DNTS_PROVIDER_RC",
            "-Xclang",
            "-ast-dump",
            "-fsyntax-only",
        ])
        .arg(root.join("runtime/c/nts_runtime.c"))
        .output()
        .expect("clang is required to check C raising contracts");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let graph = Graph::of(&String::from_utf8_lossy(&output.stdout));
    assert!(
        graph.edges.len() > 300,
        "the implementation call graph must be present"
    );
    assert!(
        graph.indirect.len() > 20,
        "indirect calls must be inspected"
    );
    let mut roots = vec!["nts_raise"];
    let mut unknown = Vec::new();
    for (owner, target) in &graph.indirect {
        match callback_raises(owner, target) {
            Some(true) => roots.push(owner),
            Some(false) => {}
            None => unknown.push((owner, target)),
        }
    }
    assert!(
        unknown.is_empty(),
        "indirect calls without effect contracts: {unknown:?}"
    );
    let raising = graph.reaching(roots);
    for name in runtime::helper_names() {
        if runtime::raising(name) == Some(Raising::NoRaise) {
            assert!(
                !raising.contains(name),
                "no-raise {name} reaches a language-raising operation"
            );
        }
    }
}

#[test]
fn transitive_raise_and_cycles_do_not_evade_the_check() {
    let graph = Graph {
        edges: BTreeMap::from([
            (
                "declared_no_raise".into(),
                BTreeSet::from(["middle".into()]),
            ),
            (
                "middle".into(),
                BTreeSet::from(["declared_no_raise".into(), "nts_raise".into()]),
            ),
        ]),
        ..Graph::default()
    };
    assert!(graph.reaching(["nts_raise"]).contains("declared_no_raise"));
    assert!(!graph.reaching(["absent"]).contains("declared_no_raise"));
}

#[test]
fn clang_sees_a_transitive_raise_but_not_diagnostic_text() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    for (body, expected) in [
        ("hidden_raise();", true),
        ("(void)\" Function 0x 'nts_raise' \";", false),
    ] {
        let source = format!(
            "#include \"nts_runtime.h\"\n\
             static void hidden_raise(void) {{ nts_raise(nts_value_of_number(7)); }}\n\
             double nts_math_imul(double a, double b) {{ {body} return a + b; }}\n"
        );
        let mut child = std::process::Command::new("clang")
            .args(["-std=c11", "-Xclang", "-ast-dump", "-fsyntax-only", "-I"])
            .arg(root.join("runtime/c"))
            .args(["-x", "c", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("clang is required for the C effect control");
        child
            .stdin
            .take()
            .expect("piped source")
            .write_all(source.as_bytes())
            .expect("write source control");
        let output = child.wait_with_output().expect("C effect control result");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let graph = Graph::of(&String::from_utf8_lossy(&output.stdout));
        assert_eq!(
            graph.reaching(["nts_raise"]).contains("nts_math_imul"),
            expected
        );
    }
}
