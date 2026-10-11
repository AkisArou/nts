#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn accessor_rows_preserve_record_inheritance_and_real_methods_still_block_it() {
    let tsgo = nts_frontend_ts::tsgo::locate().expect("tsgo is built");
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/field-rows/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    let mut program = hir::prepare(&snapshot).expect("valid HIR").program;
    let child = program
        .layouts
        .iter()
        .position(|layout| layout.name == "Child")
        .expect("Child");
    let parent = program
        .record_parents
        .iter()
        .find_map(|(ty, base)| program.layouts[child].types.contains(ty).then_some(*base))
        .expect("declared record parent");
    let parent = program
        .layouts
        .iter()
        .position(|layout| layout.types.contains(&parent))
        .unwrap();
    assert!(program.layouts[child].methods.iter().any(Option::is_some));
    assert_eq!(
        nts_codegen_jvm::hierarchy::jvm_base(&program, &program.layouts[child]),
        Some(parent)
    );
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(
        !emitted.diagnostics.iter().any(|d| d.code == "NTS4009"),
        "{:?}",
        emitted.diagnostics
    );
    let at = program.layouts[child].methods.len();
    assert!(
        !program
            .interface_access
            .contains_selector(u32::try_from(at).unwrap())
    );
    program.layouts[child]
        .methods
        .push(Some("real_method".to_owned()));
    assert_eq!(
        nts_codegen_jvm::hierarchy::jvm_base(&program, &program.layouts[child]),
        None
    );
}
