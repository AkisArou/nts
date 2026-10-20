#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

pub(crate) mod hir;

use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
}

pub(crate) fn run(
    label: &str,
    emitted: &nts_codegen_wasm::Emitted,
    script: &str,
    args: &[&Path],
) -> serde_json::Value {
    run_with_node_flags(label, emitted, script, args, &[])
}

/// Where a test keeps its artifacts, when `NTS_WASM_TEST_ARTIFACTS` names one.
pub(crate) fn retained() -> Option<PathBuf> {
    std::env::var_os("NTS_WASM_TEST_ARTIFACTS").map(PathBuf::from)
}

/// An emitted module and its glue for `host`, written where a test runs it:
/// under `NTS_WASM_TEST_ARTIFACTS`, kept, or in a fresh temporary directory.
pub(crate) fn write_artifact(
    label: &str,
    emitted: &nts_codegen_wasm::Emitted,
    host: nts_codegen_wasm::Host,
) -> PathBuf {
    let artifact = retained().map_or_else(
        || std::env::temp_dir().join(format!("nts-wasm-{label}-{}", std::process::id())),
        |root| root.join(label),
    );
    std::fs::create_dir_all(&artifact).unwrap();
    std::fs::write(artifact.join("program.wasm"), &emitted.bytes).unwrap();
    std::fs::write(
        artifact.join("program.wasm.json"),
        serde_json::to_vec_pretty(&emitted.manifest).unwrap(),
    )
    .unwrap();
    let glue = nts_codegen_wasm::glue(&emitted.manifest, host).unwrap();
    std::fs::write(artifact.join(nts_codegen_wasm::PROGRAM_FILE), glue.program).unwrap();
    std::fs::write(
        artifact.join(nts_codegen_wasm::INSTANCE_FILE),
        glue.instance,
    )
    .unwrap();
    artifact
}

pub(crate) fn run_with_node_flags(
    label: &str,
    emitted: &nts_codegen_wasm::Emitted,
    script: &str,
    args: &[&Path],
    flags: &[&str],
) -> serde_json::Value {
    run_node(label, emitted, script, args, flags, None)
}

/// [`run_with_node_flags`] with node held to `bytes` of address space, the
/// bound the differential puts on every program it runs (`prlimit --as`).
pub(crate) fn run_within(
    label: &str,
    emitted: &nts_codegen_wasm::Emitted,
    script: &str,
    args: &[&Path],
    flags: &[&str],
    bytes: u64,
) -> serde_json::Value {
    run_node(label, emitted, script, args, flags, Some(bytes))
}

fn run_node(
    label: &str,
    emitted: &nts_codegen_wasm::Emitted,
    script: &str,
    args: &[&Path],
    flags: &[&str],
    bound: Option<u64>,
) -> serde_json::Value {
    let retained = retained();
    // NTS_WASM_BROWSER runs every check in headless Chromium, on browser glue.
    let browser = std::env::var_os("NTS_WASM_BROWSER").is_some();
    let host = if browser {
        nts_codegen_wasm::Host::Browser
    } else {
        nts_codegen_wasm::Host::Node
    };
    let artifact = write_artifact(label, emitted, host);
    let mut command = match bound {
        Some(bytes) if !browser => {
            let mut bounded = Command::new("prlimit");
            bounded.arg(format!("--as={bytes}")).arg("node");
            bounded
        }
        _ => Command::new("node"),
    };
    if browser {
        // The runner strips TypeScript types itself, so node flags do not apply.
        command.arg(repository().join("tooling/wasm/browser/run.mjs"));
    } else {
        command.args(flags);
    }
    let result = command
        .arg(repository().join(script))
        .arg(&artifact)
        .args(args)
        .output()
        .expect("Node installed");
    if !result.status.success() {
        // The whole output goes to a file beside the kept artifact as well as
        // into the panic: a filter over test output once dropped the only
        // copy of a failure's text.
        let failure = artifact.join("failure.txt");
        let text = format!(
            "{script} {}\nstatus {}\n--- stdout\n{}\n--- stderr\n{}\n",
            artifact.display(),
            result.status,
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        std::fs::write(&failure, &text).unwrap();
        panic!("check failed; full output in {}\n{text}", failure.display());
    }
    let output = serde_json::from_slice(&result.stdout).unwrap();
    if retained.is_some() {
        std::fs::write(artifact.join("execution.json"), &result.stdout).unwrap();
    }
    if retained.is_none() {
        std::fs::remove_dir_all(artifact).unwrap();
    }
    output
}

/// The module's function names by function index; unnamed slots stay empty.
pub(crate) fn function_names(bytes: &[u8]) -> Vec<String> {
    let mut names = vec![];
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        if let wasmparser::Payload::CustomSection(section) = payload.unwrap()
            && let wasmparser::KnownCustom::Name(reader) = section.as_known()
        {
            for name in reader {
                if let wasmparser::Name::Function(map) = name.unwrap() {
                    for naming in map {
                        let naming = naming.unwrap();
                        let index = naming.index as usize;
                        names.resize_with(names.len().max(index + 1), String::new);
                        naming.name.clone_into(&mut names[index]);
                    }
                }
            }
        }
    }
    names
}

/// Callee names by caller name, for tests that pin an emitted entry's shape.
pub(crate) fn calls_by_name(bytes: &[u8]) -> std::collections::BTreeMap<String, Vec<String>> {
    callees(bytes, false)
}

/// [`calls_by_name`] with an imported callee named `module.field`, for a test
/// that pins what reaches the host, which the inliner may have moved out of a
/// helper and into its caller.
pub(crate) fn calls_by_name_with_imports(
    bytes: &[u8],
) -> std::collections::BTreeMap<String, Vec<String>> {
    callees(bytes, true)
}

fn callees(bytes: &[u8], name_imports: bool) -> std::collections::BTreeMap<String, Vec<String>> {
    let mut names = function_names(bytes);
    let mut function_imports = 0u32;
    let mut bodies: Vec<Vec<u32>> = Vec::new();
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        match payload.unwrap() {
            wasmparser::Payload::ImportSection(imports) => {
                for group in imports {
                    for import in group.unwrap() {
                        let (_, import) = import.unwrap();
                        if matches!(import.ty, wasmparser::TypeRef::Func(_)) {
                            if name_imports {
                                let index = function_imports as usize;
                                names.resize_with(names.len().max(index + 1), String::new);
                                names[index] = format!("{}.{}", import.module, import.name);
                            }
                            function_imports += 1;
                        }
                    }
                }
            }
            wasmparser::Payload::CodeSectionEntry(body) => {
                let mut calls = Vec::new();
                for operator in body.get_operators_reader().unwrap() {
                    // A tail call is a call: the emitter makes one of a call
                    // whose result its caller returns.
                    if let Ok(
                        wasmparser::Operator::Call { function_index }
                        | wasmparser::Operator::ReturnCall { function_index },
                    ) = operator
                    {
                        calls.push(function_index);
                    }
                }
                bodies.push(calls);
            }
            _ => {}
        }
    }
    bodies
        .into_iter()
        .enumerate()
        .filter_map(|(at, calls)| {
            #[allow(
                clippy::cast_possible_truncation,
                reason = "a test module's function count"
            )]
            let index = (function_imports + at as u32) as usize;
            let name = names.get(index)?.clone();
            if name.is_empty() {
                return None;
            }
            let callees = calls
                .iter()
                .filter_map(|call| names.get(*call as usize).cloned())
                .filter(|callee| !callee.is_empty())
                .collect();
            Some((name, callees))
        })
        .collect()
}
