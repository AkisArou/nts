//! Ambient explanation entries are distinct from bodies actually refused.
use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir::{self, Uncompiled, UncompiledKind};
use nts_frontend_ts::Frontend;

struct Fixture(Utf8PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        drop(std::fs::remove_dir_all(&self.0));
    }
}

fn prepare(name: &str, source: &str) -> hir::Prepared {
    let root = Utf8Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("refusal-kind-{name}-{}", std::process::id()));
    let fixture = Fixture(root);
    std::fs::create_dir_all(&fixture.0).expect("fixture directory");
    std::fs::write(fixture.0.join("main.ts"), source).expect("source");
    let libc = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../runtime/native/libc.d.ts")
        .canonicalize_utf8()
        .expect("libc");
    let config = fixture.0.join("tsconfig.json");
    std::fs::write(&config, format!(
        r#"{{"compilerOptions":{{"target":"ESNext","module":"ESNext","strict":true,"types":[]}},"files":["main.ts",{libc:?}]}}"#,
    )).expect("tsconfig");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("capture");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    hir::prepare(&snapshot).expect("valid HIR")
}

#[test]
fn unused_native_declarations_do_not_refuse_any_body() {
    let prepared = prepare(
        "clean",
        "export function good(n: number): number { return n + 1; }\n",
    );
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    assert!(
        prepared
            .program
            .uncompiled
            .iter()
            .any(|entry| entry.name == "WithSignals#emit")
    );
    assert!(
        prepared
            .program
            .uncompiled
            .iter()
            .all(|entry| entry.kind == UncompiledKind::ExplanationOnly)
    );
    assert_eq!(prepared.program.refused_bodies().count(), 0);
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|func| func.name == "good")
    );
}

#[test]
fn a_real_call_to_an_unimplemented_member_refuses_its_caller_with_a_diagnostic() {
    let prepared = prepare(
        "caller",
        "interface Missing { read(): number; }\nexport function invoke(x: Missing): number { return x.read(); }\nexport function control(x: Missing): number { return 1; }\n",
    );
    assert!(
        prepared
            .program
            .uncompiled
            .iter()
            .any(|entry| entry.name == "Missing#read"
                && entry.kind == UncompiledKind::ExplanationOnly)
    );
    assert!(
        prepared
            .program
            .refused_bodies()
            .any(|entry| entry.name == "invoke")
    );
    for entry in prepared.program.refused_bodies() {
        assert!(
            prepared
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message.contains(&format!("`{}`", entry.name))),
            "missing diagnostic for {entry:?}"
        );
    }
    assert!(
        !prepared
            .program
            .funcs
            .iter()
            .any(|func| func.name == "invoke")
    );
    assert!(
        prepared
            .program
            .funcs
            .iter()
            .any(|func| func.name == "control")
    );
}

#[test]
fn kinds_belong_to_entries_even_when_names_are_repeated() {
    let program = hir::Program {
        uncompiled: vec![
            Uncompiled::explanation("same".into(), "declaration".into()),
            Uncompiled::refused("same".into(), "body".into()),
        ],
        ..hir::Program::default()
    };
    let bodies: Vec<_> = program.refused_bodies().collect();
    assert_eq!(bodies.len(), 1);
    assert_eq!(bodies[0].reason, "body");
}

#[test]
fn source_body_and_synthetic_caller_refusals_keep_their_diagnostics() {
    let repo = Utf8Path::new(env!("CARGO_MANIFEST_DIR"));
    for (fixture, callers, code) in [
        (
            repo.join("tests/programs/accessor-refusal-chain/tsconfig.json"),
            &["readFace", "unknownReceiver"][..],
            "NTS1003",
        ),
        (
            repo.join(
                "../../tests/refusals/a-literal-method-helper-has-a-narrowing-caller/tsconfig.json",
            ),
            &["result"][..],
            "NTS1001",
        ),
    ] {
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&fixture)
            .expect("capture");
        let prepared = hir::prepare(&snapshot).expect("valid HIR");
        for caller in callers {
            assert!(
                prepared
                    .program
                    .refused_bodies()
                    .any(|entry| entry.name == *caller),
                "{caller}: {:?}",
                prepared.program.uncompiled
            );
            let body = prepared
                .program
                .refused_bodies()
                .find(|entry| entry.name == *caller)
                .expect("refused body");
            let diagnostic = prepared
                .diagnostics
                .iter()
                .find(|diagnostic| {
                    diagnostic.code == code
                        && if code == "NTS1003" {
                            // A real missing-callee cascade names its containing caller.
                            diagnostic.message.contains(&format!("`{caller}`"))
                        } else {
                            // A direct source-body refusal reports the construct and
                            // records the function name separately with this same reason.
                            diagnostic.message == body.reason
                        }
                })
                .expect("the diagnostic must match this refusal's actual kind");
            eprintln!("{caller}: {} {}", diagnostic.code, diagnostic.message);
        }
    }
}
