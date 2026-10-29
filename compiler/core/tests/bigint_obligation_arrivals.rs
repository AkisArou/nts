//! Every real loop arrival must reach the strict bigint range obligation.

use camino::Utf8Path;
use nts_core::hir::{self, Memory, Unprepared};
use nts_frontend_ts::Frontend;

#[test]
fn a_shifted_bigint_beyond_the_old_round_limit_must_not_fit_a_written_kind() {
    // The fixtures differ only in the tail value: 2^80 versus 1. The loop
    // carries 128 BigInt phis, independently of its small CFG's block count.
    for (fixture, rejected) in [("subject", true), ("control", false)] {
        let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!(
                "tests/programs/bigint-range-last-arrival/{fixture}/tsconfig.json"
            ))
            .canonicalize_utf8()
            .expect("checked-in fixture");
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("capture fixture");
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        for provider in [Memory::NoGc, Memory::ReferenceCounting, Memory::HostGc] {
            match hir::prepare_with(
                &snapshot,
                &hir::Options {
                    provider,
                    ..hir::Options::default()
                },
            ) {
                Ok(prepared) => {
                    assert!(
                        !rejected,
                        "{fixture}/{provider:?}: an unfinished range licensed the store"
                    );
                    assert!(
                        prepared.program.uncompiled.is_empty(),
                        "{:?}",
                        prepared.program.uncompiled
                    );
                    assert!(
                        prepared.diagnostics.is_empty(),
                        "{:?}",
                        prepared.diagnostics
                    );
                }
                Err(Unprepared::Rejected(diagnostics)) => {
                    assert!(rejected, "{fixture}/{provider:?}: {diagnostics:?}");
                    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
                    assert_eq!(diagnostics[0].code, "NTS5001");
                    assert!(
                        diagnostics[0]
                            .message
                            .contains("this store into `narrowed`"),
                        "{diagnostics:?}"
                    );
                    assert!(
                        diagnostics[0].message.contains("1208925819614629174706176"),
                        "{diagnostics:?}"
                    );
                }
                Err(other) => panic!("{fixture}/{provider:?}: {other:?}"),
            }
        }
    }
}
