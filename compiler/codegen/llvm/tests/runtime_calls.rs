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
    let dir = ScratchDir::in_target("argument-types");
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
            ..hir::Options::new(
                nts_core::hir::backend::Backend::Llvm,
                nts_core::hir::EntryUnwind::Terminal,
            )
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
fn erased_runtime_arguments_match_each_targets_abi() {
    let input = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/windows-arm-erased-argument/tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&input)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(
        &snapshot,
        nts_core::hir::backend::Backend::Llvm,
        nts_core::hir::EntryUnwind::Terminal,
    )
    .unwrap();
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
        (Platform::WINDOWS_ARM64, "[2 x i64] "),
    ] {
        let control = nts_codegen_llvm::emit(&prepared.program, platform);
        assert!(control.diagnostics.is_empty(), "{:?}", control.diagnostics);
        assert!(
            control
                .text
                .contains(&format!("@nts_value_truthy_fn({argument}"))
        );
    }
    let dir = ScratchDir::in_target("windows-arm-assembly");
    let module = nts_codegen_llvm::emit(&prepared.program, Platform::WINDOWS_ARM64);
    std::fs::write(dir.join("program.ll"), module.text).unwrap();
    // Clang's C caller is an independent ABI control of the same sixteen bytes.
    std::fs::write(
        dir.join("control.c"),
        r"
        typedef struct { unsigned int tag; unsigned long long bits; } NtsValue;
        extern _Bool nts_value_truthy_fn(NtsValue);
        _Bool control(const NtsValue *value) { return nts_value_truthy_fn(*value); }
    ",
    )
    .unwrap();
    for input in ["program.ll", "control.c"] {
        let output = Command::new("clang")
            .args([
                "-target",
                "aarch64-pc-windows-msvc",
                "-Werror",
                "-Wno-override-module",
                "-O1",
                "-S",
            ])
            .arg(dir.join(input))
            .args(["-o", "-"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{input}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let assembly = String::from_utf8(output.stdout).unwrap();
        let instructions: Vec<String> = assembly
            .lines()
            .map(|line| line.chars().filter(|ch| !ch.is_whitespace()).collect())
            .collect();
        let call = instructions
            .iter()
            .position(|line| line == "bnts_value_truthy_fn" || line == "blnts_value_truthy_fn")
            .unwrap_or_else(|| panic!("{input}: no truthy call:\n{assembly}"));
        let setup = &instructions[call.saturating_sub(3)..call];
        // C copies padding with ldp, possibly through a temporary to avoid
        // overwriting the source pointer. LLVM zero-extends the tag with ldr w0.
        let pair = setup.iter().enumerate().any(|(at, line)| {
            line.strip_prefix("ldp")
                .and_then(|operands| operands.split_once(",x1,"))
                .is_some_and(|(tag, _)| {
                    tag == "x0"
                        || setup[at + 1..]
                            .iter()
                            .any(|next| *next == format!("movx0,{tag}"))
                })
        });
        let tag = setup
            .iter()
            .any(|line| line.starts_with("ldrw0,") || line.starts_with("ldrx0,"));
        let payload = setup.iter().any(|line| line.starts_with("ldrx1,"));
        assert!(
            pair || (tag && payload),
            "{input}: the erased value must occupy x0/x1:\n{assembly}"
        );
    }
}

#[test]
fn bigint_shifts_use_the_checked_runtime_call_on_windows_arm64() {
    let (dir, program) = source_fixture(
        r"
        export function subject(seed: number): boolean {
            return (BigInt(seed) << 80n) > 0n;
        }
    ",
    );
    for (platform, target, returned, argument) in [
        (
            Platform::WINDOWS_ARM64,
            "aarch64-pc-windows-msvc",
            "i128",
            "i128 ",
        ),
        (Platform::LINUX_ARM64, "aarch64-linux-gnu", "i128", "i128 "),
        (
            Platform::WIN64_X86_64,
            "x86_64-pc-windows-msvc",
            "<2 x i64>",
            "ptr ",
        ),
    ] {
        let emitted = nts_codegen_llvm::emit(&program, platform);
        assert!(
            emitted.diagnostics.is_empty(),
            "{platform:?}: {:?}",
            emitted.diagnostics
        );
        assert!(
            emitted
                .text
                .contains(&format!("call {returned} @nts_bigint_shl({argument}")),
            "{platform:?}: {}",
            emitted.text
        );
        let input = dir.join("shift.ll");
        std::fs::write(&input, emitted.text).unwrap();
        let compiled = Command::new("clang")
            .args(["-target", target, "-Werror", "-Wno-override-module", "-c"])
            .arg(input)
            .arg("-o")
            .arg(dir.join("shift.o"))
            .output()
            .unwrap();
        assert!(
            compiled.status.success(),
            "{platform:?}: {}",
            String::from_utf8_lossy(&compiled.stderr)
        );
    }
}

#[test]
fn foreign_erased_returns_name_the_windows_abi_they_refuse() {
    let (_dir, mut program) = source_fixture(
        r"
        declare function foreign_value(): boolean;
        export function subject(): void { foreign_value(); }
    ",
    );
    // Lowering refuses a source-level foreign `unknown` result. Mutate a
    // valid prepared call so these controls exercise the backend's own ABI
    // refusal, including the System V erased-result control.
    let mut changed = 0;
    for func in &mut program.funcs {
        for op in &mut func.values {
            if let OpKind::Call {
                callee: Callee::Native(target),
                ..
            } = &mut op.kind
                && target.name == "foreign_value"
            {
                std::sync::Arc::make_mut(target).result = hir::native::Type::Erased;
                op.ty = hir::HirType::Erased;
                changed += 1;
            }
        }
    }
    assert_eq!(changed, 1, "the native call must survive preparation");
    let control = nts_codegen_llvm::emit(&program, Platform::SYSV_X86_64);
    assert!(control.diagnostics.is_empty(), "{:?}", control.diagnostics);
    for (platform, message) in [
        (
            Platform::WIN64_X86_64,
            "a C function returning an erased value under Win64, which returns it through a hidden pointer this backend does not pass; the C backend builds it (in `subject`)",
        ),
        (
            Platform::WINDOWS_ARM64,
            "a C record passed or returned by value, or an erased value, crossing a call on arm64 Windows, whose calling convention this backend does not implement; the C backend builds it (in `subject`)",
        ),
    ] {
        let refused = nts_codegen_llvm::emit(&program, platform);
        assert_eq!(
            refused.diagnostics.len(),
            1,
            "{platform:?}: {:?}",
            refused.diagnostics
        );
        assert_eq!(refused.diagnostics[0].code, "NTS3001");
        assert_eq!(refused.diagnostics[0].message, message);
    }
}

#[test]
fn windows_arm_public_erased_and_bigint_exports_remain_refused() {
    let (_dir, program) = source_fixture(
        r"
        export function erased(value: unknown): unknown { return value; }
        export function bigint(value: bigint): bigint { return value; }
    ",
    );
    for platform in [Platform::WIN64_X86_64, Platform::LINUX_ARM64] {
        let control = nts_codegen_llvm::emit(&program, platform);
        assert!(
            control.diagnostics.is_empty(),
            "{platform:?}: {:?}",
            control.diagnostics
        );
    }
    let refused = nts_codegen_llvm::emit(&program, Platform::WINDOWS_ARM64);
    assert_eq!(refused.diagnostics.len(), 2, "{:?}", refused.diagnostics);
    for name in ["erased", "bigint"] {
        assert!(refused.diagnostics.iter().any(|diagnostic| {
            diagnostic.message.contains("an exported function taking or returning an erased value or a bigint on arm64 Windows")
                && diagnostic.message.contains(&format!("in `{name}`"))
        }), "{name}: {:?}", refused.diagnostics);
    }
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

/// A construct-only property thunk passes its object, its property's name and
/// its value to the support file's variadic builder. Its object's type is the
/// one the HIR gives it; the twins differ only in that type.
fn construct_thunk(object: &str) -> (ScratchDir, hir::Program) {
    use hir::native::{GObjectThunk, PropertyOperation};
    let (dir, mut program) = source_fixture(&format!(
        r#"
import type {{ Ptr }} from "c:types";
import type {{ Float64 }} from "@nts/scalars";
declare function give(self: {object}, value: Float64): void;
export function subject(self: {object}, value: Float64): void {{ give(self, value); }}
"#
    ));
    let func = program
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
        .expect("the property call");
    let target = std::sync::Arc::make_mut(target);
    target.name = "__nts_gobject_with_d__value_0".into();
    target.thunk = Some(GObjectThunk::Property {
        operation: PropertyOperation::Construct,
        kind: 'd',
        name: "value".into(),
    });
    (dir, program)
}

#[test]
fn a_construct_thunk_calls_the_typed_builder_and_refuses_a_mistyped_object() {
    let (_dir, control) = construct_thunk("Ptr<void>");
    let emitted = nts_codegen_llvm::emit(&control, Platform::SYSV_X86_64);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    let declaration = "declare void @nts_gobject_with_builder_add(ptr, ptr, ...)";
    assert_eq!(emitted.text.matches(declaration).count(), 1);
    let call = "call void (ptr, ptr, ...) @nts_gobject_with_builder_add(ptr %a0, ptr @__nts_gobject_with_d__value_0.name, double %a1, ptr null)";
    assert_eq!(emitted.text.matches(call).count(), 1, "{}", emitted.text);
    assert!(emitted.text.find(declaration).unwrap() < emitted.text.find(call).unwrap());

    let (_dir, mistyped) = construct_thunk("Float64");
    let refused = nts_codegen_llvm::emit(&mistyped, Platform::SYSV_X86_64);
    assert!(
        refused.diagnostics.iter().any(|diagnostic| diagnostic.code == "NTS3001"
            && diagnostic.message
                == "runtime helper nts_gobject_with_builder_add parameter 1: expected ptr, found double (in `subject`)"),
        "{:?}",
        refused.diagnostics
    );
    assert!(
        !refused
            .text
            .contains("@nts_gobject_with_builder_add(double")
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

fn callee_token(token: &str) -> bool {
    token.starts_with('@') || token.starts_with('%') || token.starts_with('{')
}

/// A function type's parameter group is followed by the callee and its own
/// argument group. No call-site attribute has an SSA/global name, and an
/// unknown format field there will itself be inspected as the callee.
fn function_type_group(rest: &str, open: usize) -> bool {
    let mut depth = 0;
    for (at, character) in rest[open..].char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => continue,
        }
        if depth == 0 {
            let tail = rest[open + at + 1..].trim_start();
            let Some(next) = tail.find('(') else {
                return false;
            };
            let token = tail[..next].trim();
            return callee_token(token) && !token.contains(char::is_whitespace);
        }
    }
    false
}

/// Inspect every IR call/invoke template in the sources' string literals. Its
/// callee precedes the argument list, with or without whitespace. Function
/// types and parameter attributes may have their own parenthesized groups.
/// A callee may stay
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
        for (start, instruction) in literal
            .match_indices("call ")
            .chain(literal.match_indices("invoke "))
        {
            let before = &literal[..start];
            if !(before.is_empty()
                || before.ends_with("\\n")
                || before.ends_with("\\t")
                || before.ends_with(|c: char| !(c.is_ascii_alphanumeric() || c == '_')))
            {
                continue;
            }
            let rest = &literal[start + instruction.len()..];
            let callee = rest.match_indices('(').find_map(|(open, _)| {
                let token = rest[..open].split_ascii_whitespace().last()?;
                (callee_token(token) && !function_type_group(rest, open)).then_some(token)
            });
            // No argument list: a template ending in a field may hold the
            // callee and its arguments together.
            let Some(callee) = callee.or_else(|| {
                rest.split_ascii_whitespace()
                    .last()
                    .filter(|last| last.starts_with('{') && last.ends_with('}'))
            }) else {
                continue;
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
    // A variadic helper's call names its function type before the callee;
    // spelled by hand, it is still a bypass.
    let variadic = r#"format!("call void (ptr, ptr, ...) @nts_gobject_with_builder_add(ptr %a0, ptr @{thunk}.name, {passed}, ptr null)")"#;
    assert_eq!(
        unchecked_calls(variadic, &declared),
        ["nts_gobject_with_builder_add"]
    );
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
            r#"format!("%r = call dereferenceable(8) ptr {call}")"#,
            "{call}",
        ),
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
fn the_source_audit_checks_spaced_callees_in_every_call_shape() {
    let declared = runtime_names();
    for instruction in [
        "call void",
        "tail call void",
        "invoke void",
        "call zeroext i32",
        "tail call fastcc zeroext i32",
        "invoke cc 10 zeroext i32",
        "call fastcc void (ptr)",
        "call %Result (ptr)",
        "call {result} ({})",
        "call dereferenceable(8) ptr",
    ] {
        for separator in ["", " ", "\t"] {
            for (callee, expected) in [("@nts_release", "nts_release"), ("{callee}", "{callee}")] {
                let source = format!(r#"format!("{instruction} {callee}{separator}(ptr %x)")"#);
                assert_eq!(unchecked_calls(&source, &declared), [expected], "{source}");
            }
            let control = format!(r#"format!("{instruction} %callback{separator}(ptr %x)")"#);
            assert!(unchecked_calls(&control, &declared).is_empty(), "{control}");
        }
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
