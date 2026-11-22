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

fn source_fixture(source: &str) -> (ScratchDir, hir::Program) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = ScratchDir::new(&root.join("target/runtime-call-tests"), "argument-types");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","{root}/runtime/native/libc.d.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
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

fn fixture(argument_type: &str) -> (ScratchDir, hir::Program) {
    source_fixture(&format!(
        "export function subject(s: string, separator: string, wrong: {argument_type}): string[] {{ return s.split(separator); }}\n"
    ))
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

/// A skipped first child must not consume the section's declaration. This
/// deliberately malformed thunk is a control of the emitter's own authority,
/// independent of what lowering currently guarantees about child indices.
#[test]
fn an_invalid_child_before_a_valid_child_keeps_the_support_declaration() {
    use hir::native::{Family, ForeignParent, GObjectThunk, GType};
    let (_dir, mut control) = source_fixture(
        r#"
import type { Ptr } from "c:types";
declare function child(self: Ptr<void>): Ptr<void>;
export function subject(self: Ptr<void>): Ptr<void> { return child(self); }
"#,
    );
    let func = control
        .funcs
        .iter_mut()
        .find(|func| func.name == "subject")
        .unwrap();
    let target = func
        .values
        .iter_mut()
        .find_map(|op| match &mut op.kind {
            OpKind::Call {
                callee: Callee::Native(target),
                ..
            } => Some(target),
            _ => None,
        })
        .expect("the child call");
    let target = std::sync::Arc::make_mut(target);
    target.name = "nts_gobject_child_ChildScope_0".into();
    target.thunk = Some(GObjectThunk::Child {
        class: "ChildScope".into(),
        index: 0,
    });
    let mut invalid = func.clone();
    invalid.name = "invalid_first".into();
    for op in &mut invalid.values {
        if let OpKind::Call {
            callee: Callee::Native(target),
            ..
        } = &mut op.kind
        {
            let target = std::sync::Arc::make_mut(target);
            target.name = "nts_gobject_child_Missing_0".into();
            target.thunk = Some(GObjectThunk::Child {
                class: "Missing".into(),
                index: 0,
            });
        }
    }
    control.foreign_classes.push(hir::ForeignClass {
        family: Family::GObject,
        name: "ChildScope".into(),
        type_name: None,
        superclass: ForeignParent::GObject(GType::Declared("parent_get_type".into())),
        methods: vec![],
        protocols: vec![],
        state: None,
        composition: None,
        signals: vec![],
        properties: vec![],
        template: Some(hir::Template {
            text: hir::TemplateText::Literal("<interface/>".into()),
            children: vec!["child".into()],
            callbacks: vec![],
        }),
    });
    let clean = nts_codegen_llvm::emit(&control, Platform::SYSV_X86_64);
    assert!(clean.diagnostics.is_empty(), "{:?}", clean.diagnostics);
    let declaration = "declare ptr @nts_gtk_template_child(ptr, i64, ptr)";
    assert_eq!(clean.text.matches(declaration).count(), 1);
    assert!(clean.text.contains("call ptr @nts_gtk_template_child("));
    control.funcs.insert(0, invalid);
    let emitted = nts_codegen_llvm::emit(&control, Platform::SYSV_X86_64);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    assert_eq!(emitted.text.matches(declaration).count(), 1);
    assert_eq!(
        emitted
            .text
            .matches("call ptr @nts_gtk_template_child(")
            .count(),
        1
    );
    assert!(
        emitted.text.find(declaration).unwrap()
            < emitted
                .text
                .find("call ptr @nts_gtk_template_child(")
                .unwrap()
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
    .chain(nts_codegen_llvm::GOBJECT_SUPPORT_SIGNATURES)
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

/// The contents of the Rust string literals in `source`. Comments, character
/// literals and lifetimes are skipped, so only text the emitter can render is
/// read as IR.
fn literals(source: &str) -> Vec<&str> {
    let bytes = source.as_bytes();
    let ident = |at: usize| bytes[at].is_ascii_alphanumeric() || bytes[at] == b'_';
    let mut found = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let rest = &source[at..];
        if rest.starts_with("//") {
            at += rest.find('\n').unwrap_or(rest.len());
        } else if rest.starts_with("/*") {
            at += rest.find("*/").map_or(rest.len(), |end| end + 2);
        } else if (at == 0 || !ident(at - 1))
            && let Some(raw) = rest
                .strip_prefix("br")
                .or_else(|| rest.strip_prefix('r'))
                .filter(|raw| raw.trim_start_matches('#').starts_with('"'))
        {
            let hashes = raw.len() - raw.trim_start_matches('#').len();
            let open = at + (rest.len() - raw.len()) + hashes + 1;
            let close = format!("\"{}", "#".repeat(hashes));
            let end = source[open..]
                .find(&close)
                .map_or(source.len(), |end| open + end);
            found.push(&source[open..end]);
            at = end + close.len();
        } else if bytes[at] == b'"' {
            let open = at + 1;
            let mut end = open;
            while end < bytes.len() && bytes[end] != b'"' {
                end += if bytes[end] == b'\\' { 2 } else { 1 };
            }
            found.push(&source[open..end.min(bytes.len())]);
            at = end + 1;
        } else if bytes[at] == b'\'' {
            // A character literal is skipped whole, so `'"'` opens nothing;
            // a lifetime is a single quote.
            let mut chars = rest[1..].char_indices();
            at += match chars.next() {
                Some((_, '\\')) => rest[2..].find('\'').map_or(1, |end| end + 3),
                Some((_, c)) if rest[1 + c.len_utf8()..].starts_with('\'') => 2 + c.len_utf8(),
                _ => 1,
            };
        } else {
            at += 1;
        }
    }
    found
}

/// Inspect every IR call template in the sources' string literals. Its callee
/// is the token written directly before the argument list (a function type,
/// written with a space before its parenthesis, is skipped). A callee may stay
/// outside the checked constructor only when the audit can prove it is not a
/// helper: an SSA value, or a global template disjoint from every
/// declaration. A format field as callee proves nothing; it is reported, as
/// is a call template ending in one, which may hold the whole call.
fn unchecked_calls<'a>(
    source: &'a str,
    declared: &std::collections::HashSet<&str>,
) -> Vec<&'a str> {
    let mut found = Vec::new();
    for literal in literals(source) {
        for (start, _) in literal.match_indices("call ") {
            let before = &literal[..start];
            if !(before.is_empty()
                || before.ends_with("\\n")
                || before.ends_with("\\t")
                || before.ends_with(|c: char| !(c.is_ascii_alphanumeric() || c == '_')))
            {
                continue;
            }
            let rest = &literal[start + "call ".len()..];
            let mut tokens = rest.split_ascii_whitespace();
            let callee = tokens
                .by_ref()
                .find_map(|token| token.find('(').filter(|&at| at > 0).map(|at| &token[..at]));
            let callee = match callee {
                Some(callee) => callee,
                // No argument list: a template ending in a field may hold the
                // callee and its arguments together.
                None => match rest.split_ascii_whitespace().last() {
                    Some(last) if last.starts_with('{') && last.ends_with('}') => last,
                    _ => continue,
                },
            };
            if callee.starts_with('{') {
                found.push(callee);
                continue;
            }
            let Some(name) = callee.strip_prefix('@') else {
                continue; // An SSA value (`%f`) or prose.
            };
            let name = name
                .strip_prefix("\\\"")
                .or_else(|| name.strip_prefix('"'))
                .unwrap_or(name);
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
    }
    found
}

#[test]
fn support_declarations_are_disjoint_from_every_canonical_table() {
    let mut support = std::collections::HashSet::new();
    for known in nts_codegen_llvm::GOBJECT_SUPPORT_SIGNATURES {
        assert!(
            support.insert(known.name),
            "duplicate support name {}",
            known.name
        );
        for platform in [
            Platform::SYSV_X86_64,
            Platform::WIN64_X86_64,
            Platform::APPLE_ARM64,
            Platform::LINUX_ARM64,
            Platform::WINDOWS_ARM64,
        ] {
            assert!(
                nts_codegen_llvm::signatures::signature_on(known.name, platform).is_none(),
                "{} collides on {platform:?}",
                known.name
            );
        }
    }
}

#[test]
fn the_source_audit_checks_support_calls_and_allows_callback_addresses() {
    let declared = runtime_names();
    for known in nts_codegen_llvm::GOBJECT_SUPPORT_SIGNATURES {
        for callee in [
            known.name.to_owned(),
            format!("{}{{suffix}}", known.name),
            format!(r#"\"{}\""#, known.name),
        ] {
            let source = format!(r#"format!("call {} @{callee}()")"#, known.returns);
            assert!(!unchecked_calls(&source, &declared).is_empty(), "{source}");
        }
        let control = format!(
            r#"runtime_call::call(site, platform, "{}", &arguments)?"#,
            known.name
        );
        assert_eq!(unchecked_calls(&control, &declared), [] as [&str; 0]);
    }
    // Passing the callback's address is data, not a call. Its typed declaration
    // still belongs to the support set and a direct call is audited above.
    let address = r#"Operand::new("ptr", "@nts_gtk_init_template")"#;
    assert_eq!(unchecked_calls(address, &declared), [] as [&str; 0]);
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
    // A callee held in a format field is reported whatever it holds today;
    // only the named direct-callee owner may spell one.
    for (source, callee) in [
        (
            r#"writeln!(out, "  call void {visit}(ptr %m{at})")"#,
            "{visit}",
        ),
        (
            r#"format!("{prefix}call {}{} {callee}({})", a, b, c)"#,
            "{callee}",
        ),
        (r#"format!("%r = call {returns} {call}")"#, "{call}"),
        (
            r##"format!(r#"call ptr @nts_str_split(ptr %s)"#)"##,
            "nts_str_split",
        ),
    ] {
        assert_eq!(unchecked_calls(source, &declared), [callee], "{source}");
    }
    for proved in [
        r#"format!("  call void %visit(ptr %m{at})")"#,
        r#"format!("call void ({}) %bridge({})", a, b)"#,
        r#"format!("{out} = call {ty} @llvm.abs.{ty}({ty} {}, i1 false)", x)"#,
        r#"format!("call ptr (ptr, ...) @printf(ptr %f)")"#,
        r#"runtime_call::direct("void", &callee, arguments)"#,
        r#"refuse(func, "a call to {target}, which has no symbol for")"#,
        "// call ptr @nts_str_split(ptr %s, double %bad)",
        r#"let quote = '"'; format!("{quote}call ptr %f()")"#,
    ] {
        assert_eq!(
            unchecked_calls(proved, &declared),
            [] as [&str; 0],
            "{proved}"
        );
    }
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
