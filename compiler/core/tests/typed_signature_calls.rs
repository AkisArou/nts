//! A call through a signature takes the typed entry exactly where every
//! closure that can arrive writes the ABI the site spells.
//!
//! 519195e49 sent every such call to the erased entry, which was the cure for
//! the misread where it is needed and a box per call where it is not:
//! `closure-merge` went 14x slower on the JVM. `merged` and `drive` are that
//! benchmark's shape and must call no erased entry; `callWide` (a closure
//! taking its parameter at another representation) and `callFewer` (one
//! declaring fewer parameters than the call passes) are 519195e49's cases and
//! must keep it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

#[test]
fn a_signature_call_is_typed_only_where_every_arriving_closure_agrees() {
    let Some(frontend) = nts_frontend_ts::tsgo::locate() else {
        return;
    };
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/typed-signature-calls/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    let prepared = hir::prepare(&snapshot).expect("prepared HIR");
    let program = &prepared.program;
    assert!(program.uncompiled.is_empty(), "{:?}", program.uncompiled);
    let erased = program.erased_call_slot.expect("the program has closures");
    let through_erased = |name: &str| {
        let body = program
            .funcs
            .iter()
            .find(|func| func.name == name)
            .unwrap_or_else(|| panic!("{name} is compiled"));
        body.values.iter().any(|op| {
            matches!(op.kind, OpKind::Call { callee: Callee::Closure { slot }, .. } if slot == erased)
        })
    };
    for typed in ["merged", "drive"] {
        assert!(
            !through_erased(typed),
            "{typed}: every closure that can arrive agrees, so no erased entry"
        );
    }
    for kept in ["callWide", "callFewer"] {
        assert!(
            through_erased(kept),
            "{kept}: a closure that can arrive disagrees, so the erased entry stays"
        );
    }
    // Exactly the one signature `merged` and `drive` share is published: the
    // two that a closure disagrees with are not, and neither is a closure's
    // own signature that nothing calls through.
    assert_eq!(
        program.typed_signatures.len(),
        1,
        "{:?}",
        program.typed_signatures
    );
}
