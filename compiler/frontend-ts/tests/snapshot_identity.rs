//! A native snapshot's configuration identifies the requested capture.

use camino::Utf8PathBuf;
use nts_frontend_ts::Frontend;

fn frontend() -> Frontend {
    Frontend::new(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn added_roots_and_library_paths_belong_to_the_capture_identity() {
    let default = frontend().identity();
    let roots = frontend()
        .with_added(&[Utf8PathBuf::from("additional.ts")])
        .identity();
    let libraries = frontend()
        .with_library_path(Utf8PathBuf::from("/native-test-libraries"))
        .identity();
    assert_ne!(default, roots);
    assert_ne!(default, libraries);
    assert_ne!(roots, libraries);
}

#[test]
fn the_same_configuration_has_the_same_capture_identity() {
    assert_eq!(frontend().identity(), frontend().identity());
}
