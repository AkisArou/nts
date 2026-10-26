//! Effective options reject only a construct that needs different semantics.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Unprepared};
use nts_frontend_ts::Frontend;

#[test]
fn project_semantics_reach_lowering_and_preparation_without_partial_emission() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    for (fixture, setting) in [
        (
            "tests/refusals/a-class-field-needs-define-semantics",
            Some("useDefineForClassFields"),
        ),
        ("tests/programs/a-class-field-uses-define-semantics", None),
        (
            "tests/programs/a-fieldless-class-needs-no-define-option",
            None,
        ),
        (
            "tests/refusals/a-legacy-decorator-needs-runtime-semantics",
            Some("experimentalDecorators"),
        ),
        ("tests/programs/a-decorator-option-needs-a-decorator", None),
        // This checks the option-policy boundary only. Node strip-types
        // cannot execute decorator syntax, so it is not a differential input.
        (
            "compiler/core/tests/programs/a-standard-decorator-keeps-the-class",
            None,
        ),
    ] {
        let config = root.join(fixture).join("tsconfig.json");
        let snapshot = Frontend::new(root)
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap();
        assert!(
            !snapshot.has_errors(),
            "{fixture}: {:?}",
            snapshot.diagnostics
        );
        let lowered = hir::lower::lower(&snapshot);
        if let Some(setting) = setting {
            assert_eq!(
                lowered.rejected.len(),
                1,
                "{fixture}: {:?}",
                lowered.rejected
            );
            let diagnostic = &lowered.rejected[0];
            assert_eq!(diagnostic.code, "NTS1001");
            assert!(diagnostic.message.contains(setting));
            assert!(
                !diagnostic.primary.span.is_empty(),
                "the first governed construct has a source position"
            );
            assert!(
                lowered.program.funcs.is_empty(),
                "no partial program is lowered"
            );
            assert!(
                matches!(
                    hir::prepare_with(&snapshot, &hir::Options::default()),
                    Err(Unprepared::Rejected(_))
                ),
                "preparation must preserve the program rejection"
            );
        } else {
            assert!(
                lowered.rejected.is_empty(),
                "{fixture}: {:?}",
                lowered.rejected
            );
        }
    }
}

#[test]
fn ambient_fields_do_not_require_runtime_field_semantics() {
    let root =
        camino::Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("ambient-project-semantics");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("main.ts"), "declare class External { x: number; }\nabstract class Abstract { abstract x: number; }\nexport function read(): number { return 7; }\n").unwrap();
    let config = root.join("tsconfig.json");
    std::fs::write(&config, r#"{"compilerOptions":{"target":"ES2017","strict":true,"types":[],"noEmit":true},"files":["main.ts"]}"#).unwrap();
    let snapshot = Frontend::new(&root)
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    assert!(!snapshot.semantics.use_define_for_class_fields);
    assert_eq!(hir::lower::lower(&snapshot).rejected.len(), 0);
}
