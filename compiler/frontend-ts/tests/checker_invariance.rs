//! Upstream checker scheduling must not change the captured program or errors.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::num::NonZeroU16;

use camino::Utf8PathBuf;
use nts_frontend_ts::Frontend;

#[test]
fn one_and_four_checkers_preserve_capture_and_diagnostics() {
    let root = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .unwrap()
        .join(format!("nts-checker-invariance-{}", std::process::id()));
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"es2022","module":"esnext","moduleResolution":"bundler","types":[]},"include":["src/**/*"]}"#).unwrap();
    for index in 0..8 {
        std::fs::write(
            root.join(format!("src/part{index}.ts")),
            format!(
                "export function answer{index}(value: number): number {{ return value + {index}; }}"
            ),
        )
        .unwrap();
    }
    let capture = |count| {
        Frontend::new(&root)
            .with_checkers(NonZeroU16::new(count).unwrap())
            .snapshot(&root.join("tsconfig.json"))
            .unwrap()
    };
    let serial = capture(1);
    let parallel = capture(4);
    assert!(!serial.has_errors());
    assert_eq!(serial.digest().unwrap(), parallel.digest().unwrap());
    std::fs::write(
        root.join("src/broken.ts"),
        "export const value: number = 'wrong';",
    )
    .unwrap();
    let serial = capture(1);
    let parallel = capture(4);
    assert!(serial.has_errors());
    assert_eq!(serial.diagnostics, parallel.diagnostics);
    std::fs::remove_dir_all(root).unwrap();
}
