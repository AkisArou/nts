//! A backend branch starts at pristine lowering, including its bookkeeping.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use nts_core::hir::{self, Memory, Options, PreparationOptions, RawProgram, native, reachable};
use nts_frontend_ts::Frontend;

#[test]
fn independent_preparations_match_fresh_lowering_and_leave_the_raw_program_unchanged() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = camino::Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("raw-preparation-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("main.ts"), "class Box { constructor(public value: number) {} }\nexport function make(n: number): Box { return new Box(n); }\nexport function kept(n: number): number { const box = new Box(n | 0); const step = () => { box.value++; }; step(); return box.value; }\nexport function unused(n: number): number { return n * 1.5; }\nconsole.log(kept(2));\n").unwrap();
    let config = root.join("tsconfig.json");
    std::fs::write(&config, r#"{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"bundler","strict":true,"types":[]},"files":["main.ts"]}"#).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let entry = nts_frontend_ts::entry_uris(&config, &snapshot);
    let foreign = hir::runtime::ForeignTable::default();
    let raw = RawProgram::lower(&snapshot, &entry, &foreign);
    let pristine = format!("{raw:?}");
    let names = vec!["kept".to_owned(), hir::lower::MODULE_INIT.to_owned()];
    let mut expected = Vec::new();
    for provider in [Memory::NoGc, Memory::ReferenceCounting, Memory::HostGc] {
        for roots in [
            reachable::Roots::EveryExport,
            reachable::Roots::Entry(&names),
        ] {
            for abi in [native::NativeAbi::LP64, native::NativeAbi::LLP64] {
                let options = Options {
                    provider,
                    roots,
                    entry_files: &entry,
                    foreign: &foreign,
                    targets: native::Targets::only(abi),
                    callbacks_checkpoint: true,
                    ..Options::default()
                };
                let fresh = hir::prepare_with(&snapshot, &options).unwrap();
                let branch = raw.prepare(&PreparationOptions::from(&options)).unwrap();
                assert_eq!(
                    format!("{branch:?}"),
                    format!("{fresh:?}"),
                    "including diagnostics, obligations and pass counters"
                );
                assert_eq!(
                    format!("{raw:?}"),
                    pristine,
                    "preparation must not mutate the shared input"
                );
                assert_eq!(branch.program.provider, provider);
                assert_eq!(
                    branch.program.callbacks_checkpoint,
                    options.callbacks_checkpoint
                );
                assert_eq!(
                    branch.program.funcs.iter().any(|f| f.name == "unused"),
                    matches!(roots, reachable::Roots::EveryExport)
                );
                expected.push((options, format!("{fresh:?}")));
            }
        }
    }
    // Reverse the provider/root/ABI order: no branch may inherit the previous
    // branch's placement, pruning, counts, diagnostics or renamed values.
    for (options, answer) in expected.iter().rev() {
        assert_eq!(
            format!(
                "{:?}",
                raw.prepare(&PreparationOptions::from(options)).unwrap()
            ),
            *answer
        );
    }
    let (options, answer) = expected.last().unwrap();
    assert_eq!(
        format!(
            "{:?}",
            raw.into_prepared(&PreparationOptions::from(options))
                .unwrap()
        ),
        *answer,
        "the consuming final branch has the same answer"
    );
    std::fs::remove_dir_all(root).unwrap();
}
