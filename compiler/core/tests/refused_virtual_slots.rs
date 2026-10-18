//! A refused override is a named stop, never a null slot or an inherited body.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, ManagedType, OpKind, Provider};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn stops(func: &hir::Func) -> Vec<&str> {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .filter_map(|id| {
            let OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } = &func.value(*id).kind
            else {
                return None;
            };
            if name != "nts_refused" {
                return None;
            }
            match &func.value(args[0]).kind {
                OpKind::ConstString(message) => Some(message.as_str()),
                _ => panic!("the stop must carry its reason"),
            }
        })
        .collect()
}

#[test]
fn a_synthetic_stop_does_not_publish_a_class_with_no_surviving_source_member() {
    let tsgo =
        nts_frontend_ts::tsgo::locate().expect("set NTS_TSGO; this guard needs the frontend");
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/refused-virtual-slots/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let before = hir::lower::lower(&snapshot).program;
    let published = |program: &hir::Program| {
        let mut names = program
            .published_classes()
            .map(|class| class.emitted.to_owned())
            .collect::<Vec<_>>();
        names.sort();
        names
    };
    let original = published(&before);
    assert_eq!(original, ["PublicationControl"]);
    for provider in [
        Provider::NoGc,
        Provider::ReferenceCounting,
        Provider::HostGc,
    ] {
        let prepared = hir::prepare_unverified(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::default()
            },
        );
        assert_eq!(published(&prepared.program), original, "{provider:?}");
        assert!(
            prepared
                .program
                .funcs
                .iter()
                .any(|func| !stops(func).is_empty()),
            "the publication guard must actually exercise stop entries"
        );
    }
}

#[test]
fn every_refused_receiver_has_a_typed_stop_and_valid_receivers_keep_their_bodies() {
    let tsgo =
        nts_frontend_ts::tsgo::locate().expect("set NTS_TSGO; this guard needs the frontend");
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/refused-virtual-slots/tsconfig.json");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    for provider in [
        Provider::NoGc,
        Provider::ReferenceCounting,
        Provider::HostGc,
    ] {
        let prepared = hir::prepare_unverified(
            &snapshot,
            &hir::Options {
                provider,
                ..hir::Options::default()
            },
        );
        let program = &prepared.program;
        let (_, reason) = program
            .uncompiled
            .iter()
            .find(|(name, _)| name == "Refused#value")
            .expect("the override must actually be refused");
        let declaration = program
            .funcs
            .iter()
            .find(|func| func.name == "Base#value")
            .unwrap();
        let base = program
            .layouts
            .iter()
            .find(|layout| layout.name == "Base")
            .unwrap();
        let slot = base
            .methods
            .iter()
            .position(|name| name.as_deref() == Some("Base#value"))
            .unwrap();
        assert_refused_entries(program, declaration, slot, reason);
        for (class, method) in [
            ("Compiled", "Compiled#value"),
            ("Grandchild", "Grandchild#value"),
        ] {
            let layout = program
                .layouts
                .iter()
                .find(|layout| layout.name == class)
                .unwrap();
            assert_eq!(layout.methods[slot].as_deref(), Some(method));
            assert!(
                stops(
                    program
                        .funcs
                        .iter()
                        .find(|func| func.name == method)
                        .unwrap()
                )
                .is_empty()
            );
        }
        for name in [
            "subject",
            "inherited",
            "mixed",
            "control",
            "grandchild",
            "abstractControl",
            "interfaceControl",
        ] {
            assert!(
                program.funcs.iter().any(|func| func.name == name),
                "{name}: {:?}",
                program.uncompiled
            );
        }
        assert!(
            program.uncompiled.iter().any(|(name, _)| name == "direct"),
            "direct-call cascade must stay in force"
        );
        assert!(
            !program
                .funcs
                .iter()
                .any(|func| func.name == "Refused#value")
        );
        hir::verify::verify(program).expect("the typed stop must verify under every provider");
    }
}

fn assert_refused_entries(
    program: &hir::Program,
    declaration: &hir::Func,
    slot: usize,
    reason: &str,
) {
    for class in ["Refused", "Inherited"] {
        let layout = program
            .layouts
            .iter()
            .find(|layout| layout.name == class)
            .unwrap();
        let entry = layout.methods[slot]
            .as_ref()
            .expect("a reachable refused receiver needs a real slot entry");
        let body = program
            .funcs
            .iter()
            .find(|func| &func.name == entry)
            .expect("the entry must have a body");
        assert_ne!(
            entry, "Refused#value",
            "a direct call must still see the refusal"
        );
        assert!(!body.abstract_declaration);
        assert!(
            matches!(body.params[0].ty, HirType::Managed(ManagedType::Object(ty)) if layout.types.contains(&ty))
        );
        assert_eq!(
            body.params
                .iter()
                .skip(1)
                .map(|p| &p.ty)
                .collect::<Vec<_>>(),
            declaration
                .params
                .iter()
                .skip(1)
                .map(|p| &p.ty)
                .collect::<Vec<_>>()
        );
        assert_eq!(body.return_type, declaration.return_type);
        assert!(
            stops(body)
                .iter()
                .any(|message| message.contains("Refused#value") && message.contains(reason)),
            "the stop must retain the original method and refusal: {body:?}"
        );
    }
}
