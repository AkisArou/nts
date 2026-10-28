//! A matching subject diagnostic must never hide a refused control.
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;

#[test]
fn every_builtin_study_control_survives_beside_its_subject() {
    let repo = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let catalog = include_str!("../../../results/builtin-study/probes.tsv");
    let rows: Vec<_> = catalog
        .lines()
        .filter(|line| !line.starts_with('#') && !line.is_empty())
        .collect();
    assert_eq!(rows.len(), 51, "the study population is explicit");
    let mut frontend =
        Frontend::new(env!("CARGO_MANIFEST_DIR")).with_checkers(std::num::NonZeroU16::MIN);
    for row in rows {
        let fields: Vec<_> = row.split('\t').collect();
        assert_eq!(fields.len(), 5, "catalog row: {row}");
        let fixture = fields[0];
        let config = repo
            .join("tests/refusals")
            .join(fixture)
            .join("tsconfig.json");
        let snapshot = frontend
            .snapshot(&config)
            .expect("capture builtin study fixture");
        assert!(
            !snapshot.has_errors(),
            "{fixture}: {:?}",
            snapshot.diagnostics
        );
        let options = hir::Options {
            roots: hir::reachable::Roots::EveryExport,
            ..hir::Options::default()
        };
        let prepared = hir::prepare_with(&snapshot, &options).expect("valid prepared HIR");
        let mut codes: Vec<_> = prepared
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.clone())
            .collect();
        codes.sort();
        codes.dedup();
        assert_eq!(codes.join(","), fields[4], "{fixture}: diagnostic kinds");
        let present = |name: &str| prepared.program.funcs.iter().any(|func| func.name == name);
        let refused = |name: &str| {
            prepared
                .program
                .refused_bodies()
                .any(|entry| entry.name == name)
        };
        for control in fields[1].split(',') {
            assert!(
                present(control),
                "{fixture}: control {control} was not emitted"
            );
            assert!(!refused(control), "{fixture}: control {control} refused");
        }
        for subject in fields[2].split(',') {
            match fields[3] {
                "lowers" => {
                    assert!(
                        present(subject),
                        "{fixture}: provided subject {subject} disappeared"
                    );
                    assert!(
                        !refused(subject),
                        "{fixture}: provided subject {subject} refused"
                    );
                }
                "refuses" => assert!(
                    refused(subject),
                    "{fixture}: subject {subject} no longer refuses"
                ),
                state => panic!("{fixture}: unknown state {state}"),
            }
        }
    }
}
