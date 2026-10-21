#![allow(clippy::unwrap_used, clippy::expect_used)]
//! A face of fields held three ways -- a class whose fields begin with the
//! face's, one that keeps them in another order, and a literal of the face --
//! now that a face holders do not extend is split (`split_faces`).
//!
//! These pinned the backend's two old refusals, the view (`reordered`: "requires
//! JVM stateful interfaces") and the prefix store (`ordered`: "storing a
//! `Ordered` where a `Named` is declared"). Both were the one representation --
//! a face that carries state was a JVM class its holders did not extend -- and
//! both now compile: a value of `Named` is referred to as `Named$Face`, which
//! every holder implements.

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

mod common;

fn program() -> hir::Program {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../core/tests/programs/interface-field-view/tsconfig.json")
        .canonicalize_utf8()
        .unwrap();
    let snapshot = TsgoApi::for_compilation(nts_frontend_ts::tsgo::locate().unwrap())
        .snapshot(&config)
        .unwrap();
    common::prepare(&snapshot).unwrap().program
}

/// Whether the class `name` names `interface` in its constant pool -- which a
/// class does for an interface it implements.
fn names(emitted: &nts_codegen_jvm::Emitted, name: &str, interface: &str) -> bool {
    let class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == name)
        .unwrap_or_else(|| panic!("{name} is written"));
    class
        .bytes
        .windows(interface.len())
        .any(|window| window == interface.as_bytes())
}

#[test]
fn a_view_and_a_prefix_store_to_a_face_of_fields_compile_through_its_interface() {
    let emitted = nts_codegen_jvm::emit(&program());
    for function in ["reordered", "ordered", "exact", "nameOf"] {
        assert!(
            !emitted
                .diagnostics
                .iter()
                .any(|d| d.message.contains(&format!("(in `{function}`)"))),
            "`{function}` compiles: {:?}",
            emitted.diagnostics
        );
    }
    assert!(
        emitted
            .classes
            .iter()
            .any(|class| class.binary_name == "nts/gen/Named$Face"),
        "the face's companion interface is written"
    );
    for holder in ["nts/gen/Ordered", "nts/gen/Reordered"] {
        assert!(
            names(&emitted, holder, "nts/gen/Named$Face"),
            "{holder} implements the face's interface"
        );
    }
}

#[test]
fn a_split_face_takes_its_interface_name_from_its_layout() {
    let mut program = program();
    let named = program
        .interface_identities
        .iter()
        .find(|i| i.name == "Named")
        .unwrap()
        .types[0];
    program
        .layouts
        .iter_mut()
        .find(|l| l.types.contains(&named))
        .unwrap()
        .name = "OtherRepresentative".into();
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(
        emitted
            .classes
            .iter()
            .any(|class| class.binary_name == "nts/gen/OtherRepresentative$Face"),
        "the companion follows the layout's name, as its class does"
    );
    assert!(
        !emitted
            .diagnostics
            .iter()
            .any(|d| d.message.contains("(in `ordered`)")),
        "{:?}",
        emitted.diagnostics
    );
}
