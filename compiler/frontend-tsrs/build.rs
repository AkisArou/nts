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
    let manifest = root.join("third_party/tsrs/MANIFEST");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!(
        "cargo:rustc-env=NTS_TSRS_VENDOR_HASH={:032x}",
        xxh3_128(&std::fs::read(manifest).expect("vendor manifest"))
    );
}
