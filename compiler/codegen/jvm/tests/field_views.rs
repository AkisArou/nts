#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir::{self, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn native_field_views_stop_at_the_transfer_and_keep_prefix_diagnostics() {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../core/tests/programs/interface-field-view/tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let snapshot = TsgoApi::for_compilation(nts_frontend_ts::tsgo::locate().unwrap())
        .snapshot(&config)
        .unwrap();
    let program = hir::prepare(&snapshot).unwrap().program;
    let view = program
        .funcs
        .iter()
        .find(|f| f.name == "reordered")
        .unwrap()
        .values
        .iter()
        .find(|op| matches!(op.kind, OpKind::FieldView { .. }))
        .unwrap();
    let emitted = nts_codegen_jvm::emit(&program);
    let stopped = emitted
        .diagnostics
        .iter()
        .find(|d| d.message.contains("(in `reordered`)"))
        .unwrap();
    assert_eq!(stopped.code, "NTS4001");
    assert_eq!(stopped.primary, view.origin.location);
    assert!(stopped.message.contains("interface field accessor dispatch requires JVM stateful interfaces: `Reordered` -> `Named`"), "{}", stopped.message);
    let prefix = emitted
        .diagnostics
        .iter()
        .find(|d| d.message.contains("(in `ordered`)"))
        .unwrap();
    assert!(
        prefix
            .message
            .contains("storing a `Ordered` where a `Named` is declared")
    );
    assert!(!prefix.message.contains("interface field accessor dispatch"));
    assert!(
        !emitted
            .diagnostics
            .iter()
            .any(|d| d.message.contains("(in `exact`)"))
    );
}
