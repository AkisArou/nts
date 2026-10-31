//! Check the actual IR table target type, then execute it through the C host.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;
#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

fn callback_types(text: &str) -> Result<(), String> {
    let call = text
        .lines()
        .find(|line| line.contains("call double @nts_set_timeout("))
        .ok_or("timer call absent")?;
    let slot = call
        .split(", double ")
        .nth(1)
        .and_then(|arg| arg.split(',').next())
        .and_then(|value| value.trim().strip_suffix(".0"))
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or("timer must publish an explicit planned callback column")?;
    let mut seen = 0;
    for row in text
        .lines()
        .filter(|line| line.contains(" = internal constant [") && line.contains("x ptr] ["))
    {
        let entries = row.split("x ptr] [").nth(1).unwrap().trim_end_matches(']');
        let Some(entry) = entries.split(", ").nth(slot) else {
            continue;
        };
        let Some(symbol) = entry.strip_prefix("ptr @") else {
            continue;
        };
        let symbol = format!("@{}", symbol.trim());
        let definition = text
            .lines()
            .find(|line| line.starts_with("define ") && line.contains(&format!("{symbol}(")))
            .ok_or_else(|| format!("callback {symbol} has no definition"))?;
        if !definition.starts_with("define internal void ") {
            return Err(format!(
                "callback return differs from runtime void: {definition}"
            ));
        }
        let parameters = definition
            .split_once('(')
            .unwrap()
            .1
            .split_once(')')
            .unwrap()
            .0;
        if !parameters.starts_with("ptr ") || parameters.contains(',') {
            return Err(format!(
                "callback parameters differ from runtime (ptr): {definition}"
            ));
        }
        seen += 1;
    }
    if seen == 0 {
        return Err("no populated callback entry was checked".to_owned());
    }
    Ok(())
}

fn execute(dir: &Utf8Path, text: &str, rc: bool) {
    std::fs::write(dir.join("program.ll"), text).unwrap();
    for file in nts_codegen_c::support_files(nts_codegen_c::UnicodeNeeds::NONE) {
        file.write(dir.as_std_path()).unwrap();
    }
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    for file in ["nts_test_host.h", "nts_test_host.c"] {
        std::fs::copy(root.join("runtime/c").join(file), dir.join(file)).unwrap();
    }
    std::fs::write(dir.join("caller.c"), "#include \"nts_test_host.h\"\nextern void run(double);\nextern double readAnswer(void);\nint main(void) { nts_test_host_install(); run(7.0); nts_test_host_run(8); return readAnswer()==7.0?0:1; }\n").unwrap();
    let mut command = Command::new("clang");
    command.current_dir(dir).args([
        "-O1",
        "-Wno-override-module",
        "-I.",
        "program.ll",
        "caller.c",
        "nts_runtime.c",
        "nts_test_host.c",
        "-lm",
        "-o",
        "caller",
    ]);
    if rc {
        command.arg("-DNTS_PROVIDER_RC");
    }
    let compiled = command.output().unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = Command::new(dir.join("caller")).output().unwrap();
    assert!(
        ran.status.success(),
        "{:?}: {}",
        ran.status,
        String::from_utf8_lossy(&ran.stderr)
    );
}

#[test]
fn timer_columns_only_publish_void_pointer_entries_in_the_ir() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let source = "let answer=0; export function run(n:number):void { setTimeout(()=>{ answer=n; return n+1; },0); } export function readAnswer():number { return answer; }";
    for (name, code, adapters) in [
        ("value", source.to_owned(), 1),
        ("void", source.replace("return n+1;", "return;"), 0),
    ] {
        let dir = ScratchDir::new(&root.join("target/callback-abi-tests"), name);
        std::fs::write(dir.join("main.ts"), code).unwrap();
        std::fs::write(
            dir.join("tsconfig.json"),
            format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
        )
        .unwrap();
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&dir.join("tsconfig.json"))
            .unwrap();
        assert!(!snapshot.has_errors(), "fixture must typecheck");
        for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
            let prepared = hir::prepare_with(
                &snapshot,
                &hir::Options {
                    provider,
                    ..hir::Options::default()
                },
            )
            .unwrap();
            assert!(
                prepared.diagnostics.is_empty(),
                "{:?}",
                prepared.diagnostics
            );
            let emitted =
                nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
            assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
            callback_types(&emitted.text).unwrap();
            assert_eq!(
                emitted
                    .text
                    .matches("define internal void @__nts_timer_")
                    .count(),
                adapters
            );
            if adapters != 0 {
                let mutant = emitted.text.replacen(
                    "define internal void @__nts_timer_",
                    "define internal double @__nts_timer_",
                    1,
                );
                assert!(
                    callback_types(&mutant).is_err(),
                    "signature checker must reject a changed return type"
                );
            }
            execute(
                &dir,
                &emitted.text,
                provider == hir::Memory::ReferenceCounting,
            );
        }
    }
}
