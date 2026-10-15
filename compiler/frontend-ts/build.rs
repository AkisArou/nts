mod build_support;

fn main() {
    let crate_root =
        std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("crate root"));
    let root = crate_root
        .parent()
        .and_then(std::path::Path::parent)
        .expect("workspace");
    for file in ["Cargo.toml", "Cargo.lock"] {
        println!("cargo:rerun-if-changed={}", root.join(file).display());
    }
    for &(_, dir) in build_support::CRATES {
        // Watching the directory detects a newly added source or build input.
        println!("cargo:rerun-if-changed={}", root.join(dir).display());
    }
    let mut cfg: Vec<_> = std::env::vars()
        .filter(|(name, _)| {
            name.starts_with("CARGO_CFG_") || name.starts_with("CARGO_FEATURE_") || name == "TARGET"
        })
        .collect();
    cfg.sort();
    let inputs = build_support::inputs(root).expect("all frontend stamp inputs must be readable");
    let stamp = build_support::stamp(&inputs, &cfg);
    let stamp_bytes = stamp.to_le_bytes();
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("output"));
    std::fs::write(
        output.join("frontend_stamp.rs"),
        format!(
            "/// Content stamp of the code and configuration that produce snapshots.\n\
         pub const FRONTEND_STAMP: u128 = u128::from_le_bytes({stamp_bytes:?});\n"
        ),
    )
    .expect("write frontend stamp");
}
