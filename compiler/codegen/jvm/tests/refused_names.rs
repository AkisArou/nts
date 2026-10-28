//! Constant-pool audit for a body refused during emission.

use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

const NEEDLE: &str = "discardedJvmLiteralNeedle";

#[test]
fn a_discarded_jvm_body_keeps_no_literal_from_its_unwritten_code() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .expect("repository root");
    let dir = ScratchDir::new(&root.join("target/refused-name-tests"), "jvm-late-refusal");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .expect("write project");
    std::fs::write(dir.join("main.ts"),
        format!("export function discarded(n: number): string {{ return '{NEEDLE}' + n; }}\nexport function kept(n: number): number {{ return n + 1; }}\n")
    ).expect("write source");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .expect("capture project");
    assert!(!snapshot.has_errors());
    let mut prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            specialize_numbers: false,
            ..hir::Options::default()
        },
    )
    .expect("prepare project");
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let live = nts_codegen_jvm::emit(&prepared.program);
    assert!(live.diagnostics.is_empty(), "{:?}", live.diagnostics);
    assert!(live.classes.iter().any(|class| {
        class
            .bytes
            .windows(NEEDLE.len())
            .any(|part| part == NEEDLE.as_bytes())
    }));
    let func = prepared
        .program
        .funcs
        .iter_mut()
        .find(|func| func.name == "discarded")
        .expect("discarded body");
    let promise = func.blocks[0].ops[0];
    let refusal = hir::ValueId(u32::try_from(func.values.len()).expect("value count"));
    func.values.push(hir::Op {
        kind: hir::OpKind::Await {
            promise,
            rejects_to: None,
        },
        ty: hir::HirType::Void,
        origin: func.origin.clone(),
    });
    func.blocks[0].ops.push(refusal);
    let dead = nts_codegen_jvm::emit(&prepared.program);
    assert!(
        !dead.diagnostics.is_empty(),
        "the late await must be refused"
    );
    assert!(!dead.classes.is_empty(), "the kept body must still emit");
    assert!(
        !dead.classes.iter().any(|class| class
            .bytes
            .windows(NEEDLE.len())
            .any(|part| part == NEEDLE.as_bytes())),
        "discarded body left its literal in the emitted class pool"
    );
}
