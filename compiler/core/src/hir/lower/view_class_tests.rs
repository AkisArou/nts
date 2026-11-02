//! Actual lowering populations for complete class collection and inherited
//! constructor-target membership. Values sharing storage retain class identity.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::{cell::Cell, fmt::Write as _};

thread_local! {
    static CLASSES: Cell<usize> = const { Cell::new(0) };
    static TARGETS: Cell<usize> = const { Cell::new(0) };
}
pub(super) fn note_class() {
    CLASSES.with(|n| n.set(n.get() + 1));
}
pub(super) fn note_target() {
    TARGETS.with(|n| n.set(n.get() + 1));
}

#[test]
fn distinct_and_sibling_view_classes_have_linear_collection_work() {
    let root = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for siblings in [false, true] {
        for count in [16, 64, 256] {
            let dir = std::env::temp_dir().join(format!(
                "nts-view-relations-{}-{siblings}-{count}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let mut source = String::new();
            if siblings {
                source.push_str(
                    "class Base extends Uint8Array { constructor(n: number) { super(n); } }\n",
                );
            }
            for at in 0..count {
                let base = if siblings { "Base" } else { "Uint8Array" };
                writeln!(source, "class View{at} extends {base} {{}}\nexport function probe{at}(n: number): boolean {{ return new View{at}((n & 3) + 1) instanceof View{at}; }}").unwrap();
            }
            std::fs::write(dir.join("main.ts"), source).unwrap();
            let config = dir.join("tsconfig.json");
            std::fs::write(
                &config,
                format!(
                    "{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"
                ),
            )
            .unwrap();
            let config = camino::Utf8Path::from_path(&config).unwrap();
            let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
                .with_checkers(std::num::NonZeroU16::MIN)
                .snapshot(config)
                .unwrap();
            CLASSES.with(|n| n.set(0));
            TARGETS.with(|n| n.set(0));
            let lowered = super::lower(&snapshot);
            assert!(
                lowered.program.uncompiled.is_empty(),
                "{:?}",
                lowered.program.uncompiled
            );
            assert_eq!(
                lowered.program.view_classes.iter().count(),
                count + usize::from(siblings)
            );
            for view in &lowered.program.view_classes {
                if let Some(base) = view.base {
                    assert!(
                        lowered.program.view_classes.get(base).is_some(),
                        "unnamed ancestors are still emitted"
                    );
                }
            }
            if siblings {
                assert!(
                    lowered.program.constructed_as.len() >= count,
                    "each sibling gets its inherited constructor target"
                );
            }
            let classes = CLASSES.with(Cell::get);
            let targets = TARGETS.with(Cell::get);
            eprintln!(
                "view population {count} siblings={siblings}: class visits={classes} target memberships={targets}"
            );
            assert!(classes <= count * 8 + 4);
            assert!(targets <= count * 2);
            std::fs::remove_dir_all(dir).unwrap();
        }
    }
}

#[test]
fn constructor_target_membership_is_unique_and_published_in_order() {
    for count in [16, 64, 256] {
        TARGETS.with(|n| n.set(0));
        let mut targets = super::ConstructorTargets::default();
        for at in (0..count).rev() {
            targets.insert(super::NodeId(1), super::TypeId(at));
            targets.insert(super::NodeId(1), super::TypeId(at));
        }
        let rows = targets.finish();
        assert_eq!(
            rows[&super::NodeId(1)],
            (0..count).map(super::TypeId).collect::<Vec<_>>()
        );
        assert_eq!(TARGETS.with(Cell::get), count as usize * 2);
    }
}
