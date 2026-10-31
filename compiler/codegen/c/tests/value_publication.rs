//! A separately emitted addon reads only an actual C-owned value reader.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "../../../test-support/scratch.rs"]
mod scratch;
use camino::Utf8Path;
use nts_core::hir;
use std::process::Command;

#[test]
fn value_readers_require_addon_demand_identity_and_producer_survival() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/value-publication"), "closure");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(
        dir.join("main.ts"),
        r"
export const callback=(n:number):number=>n+1;
let privateValue=0;
export function run(n:number):number { privateValue+=n; return callback(n)+privateValue; }
",
    )
    .unwrap();
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors());
    let prepared = hir::prepare_with(&snapshot, &hir::Options::default()).unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let program = &prepared.program;
    let global = program
        .globals
        .iter()
        .find(|g| g.name == "callback")
        .unwrap();
    let private = program
        .globals
        .iter()
        .find(|g| g.name == "privateValue")
        .unwrap();
    let native_plan = nts_codegen_c::EntryAbi::new(program);
    let native_output = nts_codegen_c::emit_planned(&native_plan, hir::native::NativeAbi::LP64);
    assert!(!native_output.writer.text().contains("__nts_value_reader_"));
    assert!(
        native_output
            .published_entries(&native_plan)
            .unwrap()
            .value(global)
            .is_none()
    );
    let plan = nts_codegen_c::EntryAbi::for_addon(program);
    let output = nts_codegen_c::emit_planned(&plan, hir::native::NativeAbi::LP64);
    assert!(output.is_complete(), "{:?}", output.diagnostics);
    let entries = output.published_entries(&plan).unwrap();
    let reader = entries.value(global).expect("actual public closure reader");
    assert!(std::ptr::eq(reader.global, global));
    assert_eq!(reader.result, "NtsHeader *");
    assert!(reader.linkable);
    assert!(
        entries.value(&global.clone()).is_none(),
        "same name is no identity proof"
    );
    assert!(
        entries.value(private).is_none(),
        "private storage has no addon reader"
    );
    assert!(
        output.published_entries(&native_plan).is_none(),
        "reader demand has a distinct seal"
    );
    assert!(
        output
            .published_entries(&nts_codegen_c::EntryAbi::for_addon(program))
            .is_none()
    );
    absent_readers(program, global);
    check_reader(&dir, &output, &reader);
}

fn check_reader(
    dir: &Utf8Path,
    output: &nts_codegen_c::Emitted,
    reader: &nts_codegen_c::PhysicalValue<'_>,
) {
    for support in output.support_files() {
        support.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), output.writer.text()).unwrap();
    std::fs::write(dir.join("program.h"), &output.header).unwrap();
    std::fs::write(dir.join("caller.c"), format!("#include \"program.h\"\n{} {}(void);\nint main(void){{ module__init(); return {}()!=0 && run(7.0)==15.0 ? 0 : 1; }}\n", reader.result, reader.symbol, reader.symbol)).unwrap();
    let linked = Command::new("clang")
        .current_dir(dir)
        .args([
            "-std=c11",
            "-O1",
            "-I.",
            "program.c",
            "caller.c",
            "nts_runtime.c",
            "-lm",
            "-o",
            "caller",
        ])
        .output()
        .unwrap();
    assert!(
        linked.status.success(),
        "{}",
        String::from_utf8_lossy(&linked.stderr)
    );
    let ran = Command::new(dir.join("caller")).output().unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
}

fn absent_readers(program: &hir::Program, global: &hir::Global) {
    let mut no_functions = program.clone();
    no_functions.funcs.clear();
    let at = program
        .globals
        .iter()
        .position(|g| std::ptr::eq(g, global))
        .unwrap();
    let plan = nts_codegen_c::EntryAbi::for_addon(&no_functions);
    let output = nts_codegen_c::emit_planned(&plan, hir::native::NativeAbi::LP64);
    let entries = output.published_entries(&plan).unwrap();
    assert!(
        entries.value(&no_functions.globals[at]).is_none(),
        "global metadata never manufactures an absent reader"
    );
    assert!(
        entries.value(global).is_none(),
        "a foreign Program's global is unavailable"
    );
}
