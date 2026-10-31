//! Native constants are defined only when retained output references them.

use camino::Utf8Path;
use nts_codegen_llvm::Platform;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::collections::BTreeMap;

#[path = "../../../test-support/scratch.rs"]
mod scratch;
use scratch::ScratchDir;

const SOURCE: &str = include_str!("../../common/test-support/refused-names/main.ts");

#[test]
fn refused_function_names_do_not_leave_unreferenced_private_data() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .expect("repository root");
    let control = SOURCE.replace("bytes.indexOf(n)", "bytes[0]!");
    for (label, source, refused) in [
        ("control", control.as_str(), false),
        ("refused", SOURCE, true),
    ] {
        let dir = ScratchDir::new(&root.join("target/refused-name-tests"), label);
        std::fs::write(
            dir.join("tsconfig.json"),
            format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
        )
        .expect("write project");
        std::fs::write(dir.join("main.ts"), source).expect("write source");
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&dir.join("tsconfig.json"))
            .expect("capture project");
        assert!(!snapshot.has_errors(), "{label} must typecheck");
        let prepared = hir::prepare_with(
            &snapshot,
            &hir::Options {
                provider: hir::Memory::ReferenceCounting,
                ..hir::Options::default()
            },
        )
        .expect("prepare project");
        assert_eq!(!prepared.diagnostics.is_empty(), refused, "{label}");
        let emitted = nts_codegen_llvm::emit(&prepared.program, Platform::SYSV_X86_64);
        assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
        let mut uses = BTreeMap::<String, usize>::new();
        for suffix in emitted.text.split('@').skip(1) {
            let name: String = suffix
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if ["nts_str_", "nts_template_"].iter().any(|prefix| {
                name.strip_prefix(prefix)
                    .is_some_and(|suffix| suffix.starts_with(|c: char| c.is_ascii_digit()))
            }) {
                *uses.entry(name).or_default() += 1;
            }
        }
        for (name, references) in uses {
            assert!(references > 1, "{label}: @{name} is defined but never read");
        }
    }
}

/// Requests written before a late backend refusal belong to that body, including
/// a template's cooked strings. This deliberately inserts the suspension op
/// after preparation so emission, rather than lowering, is the failure point.
#[test]
fn discarded_native_bodies_publish_neither_literals_nor_templates() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .expect("repository root");
    let dir = ScratchDir::new(&root.join("target/refused-name-tests"), "late-refusal");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .expect("write project");
    std::fs::write(dir.join("main.ts"),
        "export function discarded(n: number): string { return 'discarded-literal' + n; }\nexport function kept(n: number): number { return n + 1; }\n"
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
    let func = prepared
        .program
        .funcs
        .iter_mut()
        .find(|func| func.name == "discarded")
        .expect("discarded body");
    let origin = func.origin.clone();
    let template = hir::ValueId(u32::try_from(func.values.len()).expect("value count"));
    func.values.push(hir::Op {
        kind: hir::OpKind::ConstTemplate {
            site: 123_456,
            cooked: vec![hir::JsText::from("discarded-template")],
        },
        ty: hir::HirType::Managed(hir::ManagedType::Template),
        origin: origin.clone(),
    });
    func.blocks[0].ops.push(template);
    let live = nts_codegen_llvm::emit(&prepared.program, Platform::SYSV_X86_64);
    assert!(live.diagnostics.is_empty(), "{:?}", live.diagnostics);
    assert!(live.text.contains("@__nts_template_123456 ="));
    let live_c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(live_c.is_complete(), "{:?}", live_c.diagnostics);
    assert!(live_c.writer.text().contains("nts_template_123456 ="));
    let func = prepared
        .program
        .funcs
        .iter_mut()
        .find(|func| func.name == "discarded")
        .expect("discarded body");
    let refusal = hir::ValueId(u32::try_from(func.values.len()).expect("value count"));
    func.values.push(hir::Op {
        kind: hir::OpKind::Await {
            promise: template,
            rejects_to: None,
        },
        ty: hir::HirType::Void,
        origin,
    });
    func.blocks[0].ops.push(refusal);
    let dead = nts_codegen_llvm::emit(&prepared.program, Platform::SYSV_X86_64);
    assert!(
        !dead.diagnostics.is_empty(),
        "the late await must be refused"
    );
    assert!(!dead.text.contains("@__nts_template_123456"));
    let dead_c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(!dead_c.is_complete());
    assert!(!dead_c.writer.text().contains("nts_template_123456"));
    assert!(dead_c.writer.text().contains("kept("));
}
