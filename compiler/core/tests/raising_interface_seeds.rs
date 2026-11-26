//! Interface calls in offered raising bodies use the shared family slots.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::scratch;

use camino::Utf8Path;
use nts_core::hir::{self, Callee, Memory, OpKind, Program};
use nts_frontend_ts::Frontend;

fn prepared(fixture: &str, provider: Memory) -> Program {
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(fixture)
        .join("tsconfig.json");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot");
    assert!(!snapshot.has_errors());
    hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider,
            ..hir::Options::new(
                nts_core::hir::backend::Backend::C,
                nts_core::hir::EntryUnwind::Terminal,
            )
        },
    )
    .expect("valid prepared HIR")
    .program
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
fn an_implicit_iterator_getter_keeps_its_raising_accessor_route() {
    for provider in [Memory::NoGc, Memory::ReferenceCounting] {
        let program = prepared(
            "tests/programs/an-abrupt-protocol-exit-preserves-the-close-completion",
            provider,
        );
        assert!(
            program.refused_bodies().next().is_none(),
            "{:?}",
            program.uncompiled
        );
        let caller = program
            .funcs
            .iter()
            .find(|body| body.name == "getterCase")
            .expect("the abrupt-close body survives");
        let getter = "GetterSource#get return@raises";
        assert!(caller.values.iter().any(|op| matches!(
            &op.kind,
            OpKind::Call { callee: Callee::Direct(name), .. } if name == getter
        )));
        assert!(program.funcs.iter().any(|body| body.name == getter));
    }
}

#[test]
fn a_transitive_class_call_has_both_raising_and_nonraising_rows() {
    for provider in [Memory::NoGc, Memory::ReferenceCounting] {
        let program = prepared(
            "tests/programs/a-try-around-a-helper-that-calls-an-interface-method",
            provider,
        );
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
    for provider in [Memory::NoGc, Memory::ReferenceCounting] {
        let program = prepared(
            "tests/programs/a-throwing-literal-interface-method-one-helper-below-a-try",
            provider,
        );
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
    let program = prepared(
        "tests/refusals/a-callback-held-in-a-field-with-the-raising-gate-off",
        Memory::NoGc,
    );
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
    assert!(
        program
            .uncompiled
            .iter()
            .map(|entry| (&entry.name, &entry.reason))
            .any(|(name, _)| name == "guarded")
    );
}

#[test]
fn a_closure_gets_the_interface_implementers_raising_dispatch() {
    for provider in [Memory::NoGc, Memory::ReferenceCounting] {
        let program = prepared(
            "tests/outcomes/a-closure-calling-a-throwing-interface-method-inside-a-try",
            provider,
        );
        assert!(program.uncompiled.is_empty(), "{:?}", program.uncompiled);
        let body = program
            .funcs
            .iter()
            .find(|f| f.name == "Closure0#call@raises")
            .expect("the closure has a raising body, not an abort entry");
        let slot = body
            .values
            .iter()
            .find_map(|op| match &op.kind {
                OpKind::Call {
                    callee: Callee::Virtual { slot, declared },
                    ..
                } if declared == "Sig#throwIfAborted@raises" => Some(*slot as usize),
                _ => None,
            })
            .expect("the closure calls the interface raising slot");
        let class = program.layouts.iter().find(|l| l.name == "S").unwrap();
        assert_eq!(
            class.methods[slot].as_deref(),
            Some("S#throwIfAborted@raises")
        );
        assert!(
            program
                .funcs
                .iter()
                .any(|f| f.name == "S#throwIfAborted@raises")
        );
    }
}

fn raw_program(source: &str) -> Program {
    let scratch = scratch::ScratchDir::in_target("closure-interface-seeds");
    let config = scratch.join("tsconfig.json");
    let base = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tsconfig.fixtures.json")
        .canonicalize_utf8()
        .unwrap();
    std::fs::write(
        &config,
        format!(r#"{{"extends":{base:?},"include":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(scratch.join("main.ts"), source).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("snapshot the closure family");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    hir::lower::lower(&snapshot).program
}

fn interface_closure(implementation: &str) -> Program {
    raw_program(&format!(
        r"
        interface Quiet {{ run(): number; }}
        {implementation}
        function attempt(f: () => number): number {{
            try {{ return f(); }} catch {{ return -1; }}
        }}
        export function probe(n: number): number {{
            const receiver = make(n);
            return attempt(() => receiver.run());
        }}
    "
    ))
}

#[test]
fn an_uncarryable_interface_call_refuses_its_raising_entries_by_name() {
    let program = raw_program(
        r"
        interface Unlisted { run(): number; }
        function attempt(f: () => number): number {
            try { return f(); } catch { return -1; }
        }
        export function probe(receiver: Unlisted): number {
            return attempt(() => receiver.run());
        }
    ",
    );
    let body = "Closure0#call@raises";
    let entry = "Closure0#erased_call@raises";
    for name in [body, entry] {
        assert!(
            program
                .refused_bodies()
                .any(|refusal| { refusal.name == name && refusal.reason.contains("run") }),
            "{name}: {:?}",
            program.uncompiled
        );
        assert!(!program.funcs.iter().any(|func| func.name == name));
    }
    for name in ["Closure0#call", "Closure0#erased_call"] {
        assert!(program.funcs.iter().any(|func| func.name == name));
    }
    let slot = program.raising_call_slot.expect("the gate is on") as usize;
    let closure = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Closure0")
        .expect("the ordinary closure keeps its layout");
    assert_eq!(closure.methods[slot].as_deref(), Some(entry));
}

#[test]
fn a_quiet_interface_family_needs_no_raising_slot() {
    let program = interface_closure(
        r"
        class First implements Quiet { run(): number { return 1; } }
        class Second implements Quiet { run(): number { return 2; } }
        function make(n: number): Quiet { return n > 0 ? new First() : new Second(); }
    ",
    );
    assert!(program.uncompiled.is_empty(), "{:?}", program.uncompiled);
    assert!(
        !program
            .layouts
            .iter()
            .flat_map(|l| &l.methods)
            .flatten()
            .any(|name| name.contains("#run") && name.ends_with("@raises"))
    );
    assert!(
        !program
            .funcs
            .iter()
            .any(|f| f.name.ends_with("#run@raises"))
    );
    assert!(
        !program
            .raising_members
            .values()
            .any(|row| row.member == "run")
    );
}

#[test]
fn an_unknown_literal_supplier_keeps_the_raising_slot() {
    for provider in [Memory::NoGc, Memory::ReferenceCounting] {
        let program = prepared(
            "tests/programs/a-closure-calling-a-stored-interface-method-inside-a-try",
            provider,
        );
        assert!(
            program.refused_bodies().next().is_none(),
            "{:?}",
            program.uncompiled
        );
        let slot = program
            .funcs
            .iter()
            .filter(|body| body.name.starts_with("Closure") && body.name.ends_with("@raises"))
            .flat_map(|body| &body.values)
            .find_map(|op| match &op.kind {
                OpKind::Call {
                    callee: Callee::Virtual { slot, declared },
                    ..
                } if declared == "Wakeable#then@raises" => Some(*slot as usize),
                _ => None,
            })
            .expect("the closure retains the unknown supplier's raising slot");
        let adapter = program
            .layouts
            .iter()
            .filter_map(|layout| layout.methods.get(slot).and_then(Option::as_ref))
            .find(|target| target.contains("#then@field$") && target.ends_with("@raises"))
            .and_then(|target| program.funcs.iter().find(|body| &body.name == target))
            .expect("the stored literal supplier fills the raising slot");
        assert!(adapter.values.iter().any(|op| matches!(
            &op.kind,
            OpKind::Call { callee: Callee::Closure { slot, .. }, .. }
                if Some(*slot) == program.raising_call_slot
        )));
    }
}

#[test]
fn a_quiet_base_with_a_throwing_override_keeps_raising_dispatch() {
    for fixture in [
        "base",
        "interface",
        "structural-interface",
        "structural-interface-with-unlisted-fillers",
    ] {
        for provider in [Memory::NoGc, Memory::ReferenceCounting] {
            let program = prepared(
                &format!(
                    "tests/programs/a-closure-calling-a-throwing-override-through-a-{fixture}"
                ),
                provider,
            );
            assert!(
                program.refused_bodies().next().is_none(),
                "{:?}",
                program.uncompiled
            );
            if fixture == "structural-interface-with-unlisted-fillers" {
                let base = program
                    .layouts
                    .iter()
                    .find(|layout| layout.name == "Base")
                    .unwrap();
                assert!(
                    base.interfaces.is_empty(),
                    "Base is selected by the structural plan, not the interface filler list"
                );
            }
            assert!(
                program
                    .funcs
                    .iter()
                    .any(|body| body.name == "Sub#run@raises")
            );
            assert!(
                program
                    .funcs
                    .iter()
                    .flat_map(|body| &body.values)
                    .any(|op| matches!(
                        &op.kind,
                        OpKind::Call { callee: Callee::Virtual { declared, .. }, .. }
                            if declared.ends_with("#run@raises")
                    ))
            );
        }
    }
}
