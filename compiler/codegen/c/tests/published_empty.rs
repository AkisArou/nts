//! Fatal publication diagnostics cannot license a whole-addon view, including
//! constant-only programs that have no Func to send through the main emitter.
use nts_core::hir::{Global, HirType, Program, native::NativeAbi};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::Origin;

fn constant_program(name: &str) -> Program {
    Program {
        public_api: vec![(name.to_owned(), name.to_owned())],
        globals: vec![Global {
            name: name.to_owned(),
            ty: HirType::Float { bits: 64 },
            written: None,
            constant: true,
            initial: 7.0,
            exported: true,
            deferred: false,
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 0),
            }),
        }],
        ..Program::default()
    }
}

#[test]
fn a_fatal_constant_only_publication_has_no_sealed_addon_view() {
    for (name, available) in [("ordinary", true), ("__nts_reserved", false)] {
        let program = constant_program(name);
        let plan = nts_codegen_c::EntryAbi::new(&program);
        let emitted = nts_codegen_c::emit_planned(&plan, NativeAbi::LP64);
        assert_eq!(
            emitted.diagnostics.iter().any(|d| d.code == "NTS2007"),
            !available,
            "{name}: {:?}",
            emitted.diagnostics
        );
        assert_eq!(
            emitted.published_entries(&plan).is_some(),
            available,
            "{name}: a fatal output must not supply whole-addon authority"
        );
    }
}
