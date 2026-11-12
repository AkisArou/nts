//! Native physical arity is independent from the source declaration's arity.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use crate::scratch;
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::fmt::Write as _;

fn fixture(source: &str) -> (scratch::ScratchDir, nts_semantic_schema::SemanticSnapshot) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/entry-parameter-tests"), "roles");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors());
    (dir, snapshot)
}

#[test]
fn physical_queries_and_llvm_definitions_keep_ignored_parameters() {
    let (_dir, snapshot) = fixture(
        r"
class Base { read(n:number):number { return n; } }
class Child extends Base { value=20; override read():number { return this.value; } }
export function via(n:number):number {
 const choices:Base[]=[new Base(),new Child()];
 return choices[(n|0)&1].read(n);
}
export function own(n:number):number { const value=new Child(); value.value=n; return value.read(); }
",
    );
    let prepared = hir::prepare(&snapshot).unwrap();
    let program = &prepared.program;
    let plan = nts_codegen_c::EntryAbi::new(program);
    let c = nts_codegen_c::emit_planned(&plan, hir::native::NativeAbi::LP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let publication = c.published_entries(&plan).unwrap();
    let child = program
        .funcs
        .iter()
        .find(|f| f.name == "Child#read")
        .unwrap();
    assert_eq!(child.params.len(), 1, "source receiver only");
    let entry = publication.function(child).unwrap().unwrap();
    assert_eq!(entry.parameters, ["NtsHeader *", "double"]);
    assert!(
        std::ptr::eq(entry.function, child),
        "physical description retains source identity"
    );
    let llvm = nts_codegen_llvm::emit(program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let symbol =
        nts_codegen_common::source_symbols::SourceSymbols::new(program).function(&child.name);
    let line = llvm
        .text
        .lines()
        .find(|line| line.starts_with("define ") && line.contains(&format!("@{symbol}(")))
        .unwrap();
    let parameters = line.split_once('(').unwrap().1.split_once(')').unwrap().0;
    assert_eq!(parameters.split(',').count(), 2, "{line}");
    assert!(parameters.contains("double"), "{line}");
    assert!(
        !c.writer.text().contains("__nts_dispatch_"),
        "arity alone needs no adapter"
    );
}

fn families(size: usize, deep: bool) -> String {
    let mut source = String::from("export class Base { read(n:number):number { return n; } }\n");
    for at in 0..size {
        let parent = if deep && at > 0 {
            format!("C{}", at - 1)
        } else {
            "Base".to_owned()
        };
        writeln!(
            source,
            "export class C{at} extends {parent} {{ override read():number {{ return {at}; }} }}"
        )
        .unwrap();
        writeln!(
            source,
            "export function h{at}(value:Base):number {{ return value.read({at}); }}"
        )
        .unwrap();
    }
    source
}

#[test]
fn repeated_readers_and_deep_or_wide_families_have_linear_index_work() {
    for deep in [false, true] {
        for size in [16, 64, 256] {
            let (_dir, snapshot) = fixture(&families(size, deep));
            let prepared = hir::prepare(&snapshot).unwrap();
            let plan =
                nts_codegen_common::entry_parameters::EntryParameters::new(&prepared.program);
            let work = plan.work();
            eprintln!("deep={deep} size={size} work={work:?}");
            assert!(
                work.declarations >= size,
                "must retain repeated actual virtual readers"
            );
            assert!(
                work.padding_parameters >= size,
                "each shorter body has one physical tail"
            );
            assert!(
                work.total() <= 128 * size + 1024,
                "a reader must not rescan its whole family: {work:?}"
            );
            assert!(
                work.find_steps <= 8 * (work.functions + work.row_edges + work.declarations),
                "{work:?}"
            );
            assert!(
                prepared
                    .program
                    .funcs
                    .iter()
                    .all(|f| plan.extra(&f.clone()).is_empty()),
                "foreign same-named clones have no role"
            );
        }
    }
}

#[test]
fn a_dropped_bigint_parameter_keeps_the_integer_representation_at_direct_calls() {
    let (dir, snapshot) = fixture(
        r"
class Base { read(n:bigint):number { return Number(n); } }
class Child extends Base { override read():number { return 17; } }
export function via(n:number):number {
 const choices:Base[]=[new Base(),new Child()];
 return choices[(n|0)&1].read(3n);
}
export function own():number { return new Child().read(); }
",
    );
    let prepared = hir::prepare(&snapshot).unwrap();
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let text = llvm.text;
    assert!(
        text.contains("= add i128 0, 0"),
        "must pad the direct call as an integer: {text}"
    );
    std::fs::write(dir.join("program.ll"), &text).unwrap();
    let output = std::process::Command::new("clang")
        .args([
            "-Wno-override-module",
            "-c",
            "program.ll",
            "-o",
            "program.o",
        ])
        .current_dir(&dir)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn no_virtual_calls_do_no_family_or_tail_work() {
    let (_dir, snapshot) = fixture(
        "class Cell { read():number { return 17; } } export function run():number { return new Cell().read(); }",
    );
    let prepared = hir::prepare(&snapshot).unwrap();
    let plan = nts_codegen_common::entry_parameters::EntryParameters::new(&prepared.program);
    let work = plan.work();
    assert_eq!(work.declarations, 0);
    assert_eq!(work.row_edges, 0);
    assert_eq!(work.find_steps, 0);
    assert_eq!(work.padding_parameters, 0);
}
