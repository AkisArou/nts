//! Interface calls in offered raising bodies use the shared family slots.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, OpKind, Program, Provider};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn prepared(fixture: &str, provider: Provider) -> Option<Program> {
    let frontend = nts_frontend_ts::tsgo::locate()?;
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(fixture)
        .join("tsconfig.json");
    let snapshot = TsgoApi::for_compilation(frontend)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    Some(
        hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::new(hir::InterfaceAccess::Materialize)
            },
        )
        .expect("valid prepared HIR")
        .program,
    )
}

fn called_slot(program: &Program, caller: &str) -> usize {
    program
        .funcs
        .iter()
        .find(|body| body.name == caller)
        .expect("the helper body")
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Virtual { slot, declared },
                ..
            } if declared.starts_with("Wakeable#then") => Some(*slot as usize),
            _ => None,
        })
        .expect("the helper dispatches through Wakeable")
}

#[test]
fn a_transitive_class_call_has_both_raising_and_nonraising_rows() {
    for provider in [Provider::NoGc, Provider::ReferenceCounting] {
        let Some(program) = prepared(
            "examples/a-try-around-a-helper-that-calls-an-interface-method",
            provider,
        ) else {
            return;
        };
        assert!(program.uncompiled.is_empty(), "{:?}", program.uncompiled);
        let slot = called_slot(&program, "invoke@raises");
        for target in ["Exact#then@raises", "Quiet#then"] {
            let adapter = program
                .layouts
                .iter()
                .filter_map(|layout| layout.methods.get(slot).and_then(Option::as_ref))
                .find(|name| name.starts_with(target))
                .and_then(|name| program.funcs.iter().find(|f| &f.name == name))
                .expect("the raising family has the class's entry");
            assert!(
                adapter.name == target
                    || adapter.values.iter().any(|op| matches!(
                        &op.kind,
                        OpKind::Call { callee: Callee::Direct(name), .. } if name == target
                    )),
                "the raising family supplies {target}"
            );
        }
        assert!(!program.funcs.iter().any(|f| f.name == "Quiet#then@raises"));
    }
}

#[test]
fn a_transitive_literal_call_reaches_the_uniform_raising_entry() {
    for provider in [Provider::NoGc, Provider::ReferenceCounting] {
        let Some(program) = prepared(
            "examples/a-throwing-literal-interface-method-one-helper-below-a-try",
            provider,
        ) else {
            return;
        };
        for name in ["caught", "control"] {
            assert!(program.funcs.iter().any(|f| f.name == name));
        }
        let slot = called_slot(&program, "invoke@raises");
        let target = program
            .layouts
            .iter()
            .filter_map(|layout| layout.methods.get(slot).and_then(Option::as_ref))
            .find(|target| target.contains("#then@field$") && target.ends_with("@raises"))
            .expect("the literal's raising field adapter fills the called slot");
        let adapter = program.funcs.iter().find(|f| &f.name == target).unwrap();
        assert!(adapter.values.iter().any(|op| matches!(
            &op.kind,
            OpKind::Call { callee: Callee::Closure { slot, .. }, .. }
                if Some(*slot) == program.raising_call_slot
        )));
    }
}

#[test]
fn the_strict_gate_still_withholds_the_uniform_raising_entry() {
    let Some(program) = prepared(
        "tooling/conformance/blockers/a-callback-held-in-a-field-with-the-raising-gate-off",
        Provider::NoGc,
    ) else {
        return;
    };
    assert!(
        !program
            .funcs
            .iter()
            .any(|f| { f.name.starts_with("Closure") && f.name.ends_with("@raises") })
    );
    assert!(
        program
            .funcs
            .iter()
            .any(|f| f.name == "throughADeclaration")
    );
    assert!(program.uncompiled.iter().any(|(name, _)| name == "guarded"));
}
