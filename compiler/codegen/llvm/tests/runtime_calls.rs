//! External HIR calls are a boundary: LLVM's opaque callee pointer does not
//! check their operand types. Mutate one prepared argument after lowering so
//! the emitter itself, independently of the lowering's current checks, is
//! responsible for refusing it. The unmodified HIR is the control for both
//! native emitters.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_codegen_llvm::Platform;
use nts_core::hir::{self, Callee, OpKind, ValueId};
use nts_frontend_ts::Frontend;
use std::process::Command;

use crate::scratch::ScratchDir;

fn fixture(argument_type: &str) -> (ScratchDir, hir::Program) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/runtime-call-tests"), "argument-types");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"),
        format!("export function subject(s: string, separator: string, wrong: {argument_type}): string[] {{ return s.split(separator); }}\n")
    ).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            specialize_numbers: false,
            ..hir::Options::default()
        },
    )
    .unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    (dir, prepared.program)
}

fn wrong_argument(control: &hir::Program, param: u32) -> hir::Program {
    let mut bad = control.clone();
    let func = bad
        .funcs
        .iter_mut()
        .find(|func| func.name == "subject")
        .unwrap();
    let wrong = ValueId(
        u32::try_from(
            func.values
                .iter()
                .position(|op| matches!(op.kind, OpKind::Param(at) if at == param))
                .unwrap(),
        )
        .unwrap(),
    );
    let mut changed = 0;
    for op in &mut func.values {
        if let OpKind::Call {
            callee: Callee::External(helper),
            args,
            ..
        } = &mut op.kind
            && helper == "nts_str_split"
        {
            assert_eq!(args.len(), 2);
            args[1] = wrong;
            changed += 1;
        }
    }
    assert_eq!(
        changed, 1,
        "the fixture must reach exactly the helper under test"
    );
    bad
}

fn c_accepts(dir: &Utf8Path, program: &hir::Program) -> bool {
    std::fs::create_dir_all(dir).unwrap();
    let emitted = nts_codegen_c::emit(program, hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    let compiled = Command::new("clang")
        .args(["-std=c11", "-fsyntax-only", "-I"])
        .arg(dir)
        .arg(dir.join("program.c"))
        .output()
        .expect("clang checks the C backend's same call");
    if !compiled.status.success() {
        let error = String::from_utf8_lossy(&compiled.stderr);
        assert!(
            error.contains("nts_str_split"),
            "the refusal must name the same call: {error}"
        );
    }
    compiled.status.success()
}

#[test]
fn a_numeric_runtime_argument_is_refused_where_c_rejects_the_same_hir() {
    let (dir, control) = fixture("number");
    assert!(c_accepts(&dir.join("control"), &control));
    let bad = wrong_argument(&control, 2);
    assert!(!c_accepts(&dir.join("number"), &bad));
    for platform in [
        Platform::SYSV_X86_64,
        Platform::WIN64_X86_64,
        Platform::APPLE_ARM64,
        Platform::LINUX_ARM64,
        Platform::WINDOWS_ARM64,
    ] {
        let clean = nts_codegen_llvm::emit(&control, platform);
        assert!(
            clean.diagnostics.is_empty(),
            "{platform:?}: {:?}",
            clean.diagnostics
        );
        assert!(clean.text.contains("call ptr @nts_str_split("));
        let refused = nts_codegen_llvm::emit(&bad, platform);
        assert_eq!(
            refused.diagnostics.len(),
            1,
            "{platform:?}: {:?}",
            refused.diagnostics
        );
        assert_eq!(refused.diagnostics[0].code, "NTS3001");
        assert_eq!(
            refused.diagnostics[0].message,
            "runtime helper nts_str_split parameter 2: expected ptr, found double (in `subject`)"
        );
        assert!(!refused.text.contains("call ptr @nts_str_split("));
    }
}

#[test]
fn a_split_erased_argument_is_refused_where_c_rejects_the_same_hir() {
    let (dir, control) = fixture("unknown");
    assert!(c_accepts(&dir.join("control"), &control));
    let bad = wrong_argument(&control, 2);
    assert!(!c_accepts(&dir.join("erased"), &bad));
    let refused = nts_codegen_llvm::emit(&bad, Platform::SYSV_X86_64);
    assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
    assert_eq!(
        refused.diagnostics[0].message,
        "runtime helper nts_str_split parameter 2: expected ptr, found i32 (in `subject`)"
    );
    assert!(!refused.text.contains("call ptr @nts_str_split("));
}

#[test]
fn a_windows_arm_erased_runtime_argument_is_refused_while_other_target_abis_match() {
    let input = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/windows-arm-erased-argument/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&input)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    // The identical program differs only in target: x86 Windows passes the
    // erased argument by pointer; AAPCS64 passes its two words by value.
    for (platform, argument) in [
        (Platform::WIN64_X86_64, "ptr "),
        (Platform::LINUX_ARM64, "[2 x i64] "),
    ] {
        let control = nts_codegen_llvm::emit(&prepared.program, platform);
        assert!(control.diagnostics.is_empty(), "{:?}", control.diagnostics);
        assert!(
            control
                .text
                .contains(&format!("@nts_value_truthy_fn({argument}"))
        );
    }
    // #957 owns the incorrect Win64-x64 adapter selected on Windows ARM.
    let refused = nts_codegen_llvm::emit(&prepared.program, Platform::WINDOWS_ARM64);
    assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
    assert_eq!(refused.diagnostics[0].code, "NTS3001");
    assert_eq!(
        refused.diagnostics[0].message,
        "runtime helper nts_value_truthy_fn parameter 1: expected [2 x i64], found ptr (in `subject`)"
    );
}

fn runtime_names() -> std::collections::HashSet<&'static str> {
    [
        Platform::SYSV_X86_64,
        Platform::WIN64_X86_64,
        Platform::APPLE_ARM64,
        Platform::LINUX_ARM64,
        Platform::WINDOWS_ARM64,
    ]
    .into_iter()
    .flat_map(nts_codegen_llvm::signatures::table)
    .map(|declaration| declaration.name)
    .collect()
}

/// Format fields are wildcards over names, including empty fields and quoted
/// names. A callee template may stay outside the constructor only when it is
/// disjoint from every declaration. No variable-name or symbol exception list
/// can establish that proof.
fn template_matches(template: &str, name: &str) -> bool {
    let Some(open) = template.find('{') else {
        return template == name;
    };
    let Some(rest) = name.strip_prefix(&template[..open]) else {
        return false;
    };
    let Some(close) = template[open..].find('}') else {
        return true;
    };
    let suffix = &template[open + close + 1..];
    rest.char_indices()
        .map(|(at, _)| at)
        .chain(std::iter::once(rest.len()))
        .any(|at| template_matches(suffix, &rest[at..]))
}

/// Inspect literal and interpolated direct callees in source templates. The
/// declaration tables alone decide whether a template could name a helper.
fn unchecked_calls<'a>(
    source: &'a str,
    declared: &std::collections::HashSet<&str>,
) -> Vec<&'a str> {
    let mut found = Vec::new();
    for (start, _) in source.match_indices("call ") {
        let line = source[..start].rsplit('\n').next().unwrap_or("");
        if line.trim_start().starts_with("//") {
            continue;
        }
        let rest = &source[start + "call ".len()..];
        let Some(at) = rest.find('@') else {
            continue;
        };
        // A Rust quote ends this call's prefix; a later unrelated literal
        // naming a helper is not this call's callee.
        if !rest[..at].chars().all(|c| {
            c.is_ascii_alphanumeric() || c.is_whitespace() || "{}[]<>,().:_%\\".contains(c)
        }) {
            continue;
        }
        let target = &rest[at + 1..];
        let target = target
            .strip_prefix("\\\"")
            .or_else(|| target.strip_prefix('"'))
            .unwrap_or(target);
        let Some(end) = target.find('(') else {
            continue;
        };
        let name = target[..end].trim_end();
        let name = name
            .strip_suffix("\\\"")
            .or_else(|| name.strip_suffix('"'))
            .unwrap_or(name);
        if declared
            .iter()
            .any(|declared| template_matches(name, declared))
        {
            found.push(name);
        }
    }
    found
}

#[test]
fn the_source_audit_catches_a_bypass_and_follows_declared_membership() {
    let mut declared = runtime_names();
    let bad = r#"format!("call ptr @nts_str_split(ptr %s, double %bad)")"#;
    assert_eq!(unchecked_calls(bad, &declared), ["nts_str_split"]);
    for (source, callee) in [
        (r#"format!("call ptr @{answer}(ptr %r)")"#, "{answer}"),
        (r#"format!("call ptr @{}(ptr %r)", answer)"#, "{}"),
        (r#"format!("call ptr @\"{answer}\"(ptr %r)")"#, "{answer}"),
        (r#"format!("call ptr @nts_{kind}(ptr %r)")"#, "nts_{kind}"),
        (
            r#"format!("call ptr @{prefix}_com_{suffix}(ptr %r)")"#,
            "{prefix}_com_{suffix}",
        ),
    ] {
        assert_eq!(unchecked_calls(source, &declared), [callee]);
    }
    let control = r#"runtime_call::call(site, platform, "nts_str_split", &arguments)?"#;
    assert_eq!(unchecked_calls(control, &declared), [] as [&str; 0]);
    let support = r#"format!("call ptr @nts_support_surface(ptr %s)")"#;
    assert_eq!(unchecked_calls(support, &declared), [] as [&str; 0]);
    declared.insert("nts_support_surface");
    assert_eq!(unchecked_calls(support, &declared), ["nts_support_surface"]);
    let outside = r#"format!("call ptr @external_{entry}(ptr %r)")"#;
    assert_eq!(unchecked_calls(outside, &declared), [] as [&str; 0]);
    // Prefixes are a proof only while disjoint from the declarations. A
    // future declared name closes that path automatically, without an edit
    // to the audit or a hand-kept helper exception list.
    declared.insert("external_now_declared");
    assert_eq!(unchecked_calls(outside, &declared), ["external_{entry}"]);
}

#[test]
fn every_declared_runtime_helper_is_rendered_by_the_checked_constructor() {
    fn modules(directory: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                modules(&path, out);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    modules(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut paths,
    );
    paths.sort();
    let declared = runtime_names();
    for path in paths {
        if path
            .file_name()
            .is_some_and(|name| name == "runtime_call.rs")
        {
            continue; // The sole constructor and its deliberately malformed controls.
        }
        let source = std::fs::read_to_string(&path).unwrap();
        let bypasses = unchecked_calls(&source, &declared);
        assert!(
            bypasses.is_empty(),
            "{} bypasses the runtime-call constructor: {bypasses:?}",
            path.display()
        );
    }
}
