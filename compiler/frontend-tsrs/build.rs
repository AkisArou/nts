use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use xxhash_rust::xxh3::{Xxh3, xxh3_128};

fn sources(directory: &Path, paths: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(directory).expect("adapter source directory") {
        let path = entry.expect("adapter source entry").path();
        if path.is_dir() {
            sources(&path, paths);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            paths.push(path);
        }
    }
}

fn main() {
    let directory =
        PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo crate directory"));
    let root = directory.join("../..");
    let mut paths = vec![
        directory.join("build.rs"),
        directory.join("Cargo.toml"),
        root.join("Cargo.lock"),
        root.join("rust-toolchain.toml"),
    ];
    sources(&directory.join("src"), &mut paths);
    paths.sort();
    let mut hash = Xxh3::new();
    println!("cargo:rerun-if-changed=src");
    for path in paths {
        println!("cargo:rerun-if-changed={}", path.display());
        let bytes = std::fs::read(&path).expect("adapter identity input");
        hash.update(&(bytes.len() as u64).to_le_bytes());
        hash.update(&bytes);
    }
    let rustc = std::process::Command::new(std::env::var_os("RUSTC").expect("Cargo rustc"))
        .arg("-Vv")
        .output()
        .expect("compiler version");
    assert!(rustc.status.success(), "rustc version failed");
    hash.update(&rustc.stdout);
    println!(
        "cargo:rustc-env=NTS_TSRS_ADAPTER_HASH={:032x}",
        hash.digest128()
    );
    let upstream = root.join("third_party/tsrs/UPSTREAM.json");
    println!("cargo:rerun-if-changed={}", upstream.display());
    let upstream: serde_json::Value =
        serde_json::from_slice(&std::fs::read(upstream).expect("vendor provenance"))
            .expect("vendor provenance JSON");
    for (field, variable) in [
        ("version", "NTS_TSRS_VERSION"),
        ("commit", "NTS_TSRS_COMMIT"),
        ("typescript_commit", "NTS_TYPESCRIPT_COMMIT"),
    ] {
        let value = upstream[field].as_str().expect("vendor version field");
        assert!(
            value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-'),
            "invalid vendor version field {field}"
        );
        println!("cargo:rustc-env={variable}={value}");
    }
    let patches = upstream["patches"]
        .as_array()
        .map_or(&[][..], Vec::as_slice);
    let mut expression = String::from("&[\n");
    for patch in patches {
        let id = patch["id"].as_str().expect("carried patch id");
        let digest = patch["sha256"].as_str().expect("carried patch digest");
        assert!(
            id.bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        );
        assert!(digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()));
        writeln!(
            expression,
            "VendorPatch {{ id: {id:?}, sha256: {digest:?} }},"
        )
        .expect("write generated patch identity");
    }
    expression.push_str("]\n");
    std::fs::write(
        PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"))
            .join("vendor_patches.rs"),
        expression,
    )
    .expect("generated carried patch identity");
    let manifest = root.join("third_party/tsrs/MANIFEST");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!(
        "cargo:rustc-env=NTS_TSRS_VENDOR_HASH={:032x}",
        xxh3_128(&std::fs::read(manifest).expect("vendor manifest"))
    );
}
