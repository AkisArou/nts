//! The bench gate must execute the TypeScript layout/decision controls too.
#[test]
fn layout_instrument_controls() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let output = std::process::Command::new("node")
        .arg("--test")
        .arg(root.join("layouts.test.ts"))
        .output()
        .expect("run layout instrument controls");
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
