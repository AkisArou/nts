//! A physical entry is licensed by its actual Program and surviving emission.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "../../../test-support/scratch.rs"]
mod scratch;
use camino::Utf8Path;
use nts_core::hir;

#[test]
fn publication_requires_the_exact_plan_body_and_descriptor() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/entry-publication-tests"), "closures");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(
        dir.join("main.ts"),
        r"
export function run(n:number):number {
    const reads:Array<()=>number>=[()=>n,()=>n+1,()=>n+2];
    return reads[(((n|0)%3)+3)%3]();
}",
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
    let plan = nts_codegen_c::EntryAbi::new(program);
    let output = nts_codegen_c::emit_planned(&plan, hir::native::NativeAbi::LP64);
    assert!(output.is_complete(), "{:?}", output.diagnostics);
    let entries = output.published_entries(&plan).unwrap();
    assert!(std::ptr::eq(entries.program(), program));
    assert!(std::ptr::eq(entries.plan(), std::ptr::from_ref(&plan)));
    assert!(
        output.published_entries(&plan.clone()).is_some(),
        "a shared plan clone keeps its seal"
    );
    assert!(
        output
            .published_entries(&nts_codegen_c::EntryAbi::new(program))
            .is_none(),
        "equal inputs do not forge the producer seal"
    );
    let (layout, slot, entry) = program
        .layouts
        .iter()
        .filter(|layout| layout.types.iter().any(|ty| hir::has_a_closure_body(*ty)))
        .find_map(|layout| {
            layout.methods.iter().enumerate().find_map(|(slot, _)| {
                let entry = entries
                    .dispatch(layout, u32::try_from(slot).unwrap())
                    .unwrap()?;
                Some((layout, u32::try_from(slot).unwrap(), entry))
            })
        })
        .expect("a published closure slot");
    assert_eq!(entry.parameters.first().unwrap(), "NtsHeader *");
    assert_eq!(entry.column, program.native_column(slot));
    assert_eq!(entry.logical_slot, Some(slot));
    assert!(!entry.linkable, "private bodies stay indirect");
    assert!(entry.pointer_type().contains("(*)(NtsHeader *"));
    let definition = entries.function(entry.function).unwrap().unwrap();
    assert_eq!(definition.parameters, entry.parameters);
    assert_eq!(definition.result, entry.result);
    assert!(
        entries.function(&entry.function.clone()).unwrap().is_none(),
        "same-named Func clone is foreign"
    );
    assert!(plan.receiver_type(&entry.function.clone()).is_none());
    assert!(
        entries.dispatch(&layout.clone(), slot).unwrap().is_none(),
        "same-named Layout clone is foreign"
    );
    assert!(entries.dispatch(layout, u32::MAX).unwrap().is_none());
    missing_body(program, entry.function, layout, slot);
    fatal_publication(program);
}

fn fatal_publication(program: &hir::Program) {
    let mut bad = program.clone();
    let function = bad.funcs.iter_mut().find(|f| f.name == "run").unwrap();
    "__nts_reserved_public".clone_into(&mut function.name);
    function.exported = true;
    let plan = nts_codegen_c::EntryAbi::new(&bad);
    let emitted = nts_codegen_c::emit_planned(&plan, hir::native::NativeAbi::LP64);
    assert!(
        emitted
            .diagnostics
            .iter()
            .any(nts_codegen_c::leaves_the_program_inconsistent)
    );
    assert!(
        emitted.published_entries(&plan).is_none(),
        "a fatal publication error licenses no consumer"
    );
}

fn missing_body(program: &hir::Program, function: &hir::Func, layout: &hir::Layout, slot: u32) {
    let mut absent = program.clone();
    let index = program
        .funcs
        .iter()
        .position(|f| std::ptr::eq(f, function))
        .unwrap();
    absent.funcs[index].abstract_declaration = true;
    let absent_plan = nts_codegen_c::EntryAbi::new(&absent);
    assert!(
        absent_plan
            .function(&absent.funcs[index])
            .unwrap()
            .is_some(),
        "description is not survival"
    );
    let absent_output = nts_codegen_c::emit_planned(&absent_plan, hir::native::NativeAbi::LP64);
    let absent_entries = absent_output.published_entries(&absent_plan).unwrap();
    assert!(
        absent_entries
            .function(&absent.funcs[index])
            .unwrap()
            .is_none()
    );
    let at = program
        .layouts
        .iter()
        .position(|l| std::ptr::eq(l, layout))
        .unwrap();
    assert!(
        absent_entries
            .dispatch(&absent.layouts[at], slot)
            .unwrap()
            .is_none(),
        "a logical slot does not resurrect a missing body"
    );
    assert!(
        absent_output
            .published_entries(&nts_codegen_c::EntryAbi::new(program))
            .is_none()
    );
}
