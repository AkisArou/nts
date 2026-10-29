// Pack verified upstream bytes; GYP is evaluated only by the bootstrap exporter.
use std::{collections::BTreeMap, path::PathBuf};

fn hash(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut result = String::with_capacity(64);
    for byte in hmac_sha256::Hash::hash(bytes) {
        write!(result, "{byte:02x}").expect("writing digest");
    }
    result
}

fn main() {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("crate root"));
    let recipe = root.join("node-deps/recipes.json");
    println!("cargo:rerun-if-changed={}", recipe.display());
    let bytes = std::fs::read(&recipe).expect("committed Node dependency recipe");
    let value: serde_json::Value = serde_json::from_slice(&bytes).expect("recipe JSON");
    let files: BTreeMap<String, String> =
        serde_json::from_value(value["files"].clone()).expect("recipe file identities");
    println!(
        "cargo:rerun-if-changed={}",
        root.join("../.tool-versions").display()
    );
    let pin = std::fs::read_to_string(root.join("../.tool-versions")).expect("Node pin");
    assert!(pin.lines().any(|line| line
        == format!(
            "nodejs {}",
            value["node"].as_str().expect("recipe Node version")
        )));
    let source = root.join("../third_party/node-source");
    let mut bundle = Vec::new();
    for (name, expected) in files {
        assert!(!name.starts_with('/') && !name.split('/').any(|p| p == ".."));
        let path = source.join(&name);
        println!("cargo:rerun-if-changed={}", path.display());
        let content = std::fs::read(&path).unwrap_or_else(|error| {
            panic!(
                "{}: {error}; run node tooling/bootstrap/node.ts before building nts",
                path.display()
            )
        });
        assert_eq!(hash(&content), expected, "modified Node source: {name}");
        bundle.extend_from_slice(
            &u32::try_from(name.len())
                .expect("source path fits u32")
                .to_le_bytes(),
        );
        bundle.extend_from_slice(name.as_bytes());
        bundle.extend_from_slice(
            &u64::try_from(content.len())
                .expect("source file fits u64")
                .to_le_bytes(),
        );
        bundle.extend_from_slice(&content);
    }
    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&bundle, 6);
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"));
    std::fs::write(out.join("node-deps.zlib"), &compressed).expect("write source payload");
    println!(
        "cargo:rustc-env=NTS_NODE_BUNDLE_SHA256={}",
        hash(&compressed)
    );
    println!("cargo:rustc-env=NTS_NODE_BUNDLE_RAW_BYTES={}", bundle.len());
    println!(
        "cargo:rustc-env=NTS_NODE_BUNDLE_COMPRESSED_BYTES={}",
        compressed.len()
    );
}
