//! Independent clang classification of the optional ABI on every native target.
use nts_codegen_common::optional::{self, Arch, Passing, Target};
use nts_core::hir::{HirType, native::NativeAbi};
use std::{fmt::Write as _, path::PathBuf, process::Command};

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn split_parameters(text: &str) -> Vec<&str> {
    let mut depth = 0_i32;
    let mut start = 0;
    let mut result = vec![];
    for (i, c) in text.char_indices() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ',' if depth == 0 => {
                result.push(text[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    if start < text.len() {
        result.push(text[start..].trim());
    }
    result
}

fn arguments(definition: &str, function: &str) -> Vec<String> {
    let after = definition
        .split_once(&format!("@{function}("))
        .expect("function declaration")
        .1;
    let mut depth = 1;
    let mut end = 0;
    for (i, c) in after.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if depth == 0 {
            end = i;
            break;
        }
    }
    split_parameters(&after[..end])
        .iter()
        .map(|s| (*s).to_owned())
        .collect()
}

fn check(ir: &str, name: &str, parameters: &[HirType], returns: &HirType, target: Target) {
    let line = ir
        .lines()
        .find(|line| line.starts_with("define ") && line.contains(&format!("@{name}(")))
        .expect("emitted clang function");
    let plan = optional::plan(parameters, returns, target);
    let result = plan.result.as_ref().expect("aggregate result");
    assert!(
        line.contains(&format!(" {} @{name}(", result.result_type())),
        "{target:?}: {line}\n{plan:?}"
    );
    let mut wanted = vec![];
    if let Passing::Indirect { align, .. } = result {
        wanted.push(("ptr".to_owned(), Some(*align), false, true));
    }
    for passing in &plan.arguments {
        match passing {
            None => wanted.push(("i64".to_owned(), None, false, false)),
            Some(Passing::Registers(registers)) => {
                wanted.extend(registers.iter().map(|r| (r.llvm(), None, false, false)));
            }
            Some(Passing::Indirect { align, byval, .. }) => {
                wanted.push(("ptr".to_owned(), Some(*align), *byval, false));
            }
        }
    }
    let got = arguments(line, name);
    assert_eq!(got.len(), wanted.len(), "{target:?}: {line}\n{plan:?}");
    for (actual, (ty, align, byval, sret)) in got.iter().zip(wanted) {
        assert!(
            actual.starts_with(&format!("{ty} ")),
            "{target:?}: expected {ty}, got {actual}"
        );
        assert_eq!(actual.contains("byval("), byval, "{target:?}: {actual}");
        assert_eq!(actual.contains("sret("), sret, "{target:?}: {actual}");
        if let Some(align) = align {
            assert!(
                actual.contains(&format!("align {align}")),
                "{target:?}: {actual}"
            );
        }
    }
}

#[test]
fn every_optional_scalar_abi_matches_clang_on_six_targets() {
    let integer = |bits, signed| HirType::Int { bits, signed };
    let cases = [
        ("Bool", "_Bool", HirType::Bool),
        ("I8", "signed char", integer(8, true)),
        ("U8", "unsigned char", integer(8, false)),
        ("I16", "short", integer(16, true)),
        ("U16", "unsigned short", integer(16, false)),
        ("I32", "int", integer(32, true)),
        ("U32", "unsigned int", integer(32, false)),
        ("I64", "long long", integer(64, true)),
        ("U64", "unsigned long long", integer(64, false)),
        ("F32", "float", HirType::Float { bits: 32 }),
        ("F64", "double", HirType::NUMBER),
        ("BigInt", "__int128", HirType::BigInt),
        (
            "Pointer",
            "void *",
            HirType::NativePointer(nts_core::hir::native::Pointee::Void),
        ),
    ];
    let scratch = Scratch(
        PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("optional-abi-{}", std::process::id())),
    );
    std::fs::create_dir_all(&scratch.0).expect("ABI test directory");
    let mut source = String::new();
    for (name, c, _) in &cases {
        writeln!(source,"typedef struct {{ {c} payload; _Bool defined; }} O{name};\nO{name} identity{name}(O{name} x) {{ return x; }}\nO{name} exhausted{name}(long long a,long long b,long long c,long long d,long long e,long long f,O{name} x) {{ if(a+b+c+d+e+f==12345) x.defined=0; return x; }}").expect("source string");
    }
    let input = scratch.0.join("pairs.c");
    std::fs::write(&input, source).expect("C source");
    for (triple, arch, abi) in [
        ("x86_64-unknown-linux-gnu", Arch::X86_64, NativeAbi::LP64),
        ("x86_64-apple-darwin", Arch::X86_64, NativeAbi::LP64),
        ("x86_64-pc-windows-msvc", Arch::X86_64, NativeAbi::LLP64),
        ("aarch64-apple-darwin", Arch::Aarch64, NativeAbi::LP64),
        (
            "aarch64-unknown-linux-gnu",
            Arch::Aarch64,
            NativeAbi::LP64_UNSIGNED_CHAR,
        ),
        ("aarch64-pc-windows-msvc", Arch::Aarch64, NativeAbi::LLP64),
    ] {
        let output = Command::new("clang")
            .args([
                "-target",
                triple,
                "-std=c11",
                "-O1",
                "-S",
                "-emit-llvm",
                "-Wall",
                "-Wextra",
                "-Werror",
            ])
            .arg(&input)
            .args(["-o", "-"])
            .output()
            .expect("cross-target clang");
        assert!(
            output.status.success(),
            "{triple}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let ir = String::from_utf8(output.stdout).expect("LLVM text");
        for (name, _, payload) in &cases {
            let pair = HirType::PossiblyUndefined(Box::new(payload.clone()));
            check(
                &ir,
                &format!("identity{name}"),
                std::slice::from_ref(&pair),
                &pair,
                Target { arch, abi },
            );
            let mut parameters = vec![integer(64, true); 6];
            parameters.push(pair.clone());
            check(
                &ir,
                &format!("exhausted{name}"),
                &parameters,
                &pair,
                Target { arch, abi },
            );
        }
    }
}
