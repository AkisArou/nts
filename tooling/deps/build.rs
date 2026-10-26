use std::path::{Path, PathBuf};

fn collect(path: &Path, files: &mut Vec<PathBuf>) {
    if path.is_dir() {
        for entry in std::fs::read_dir(path).expect("dependency report inputs") {
            collect(&entry.expect("input entry").path(), files);
        }
    } else {
        files.push(path.to_owned());
    }
}

fn main() {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("crate root"));
    let mut files = vec![
        root.join("Cargo.toml"),
        root.join("build.rs"),
        root.join("../../Cargo.lock"),
    ];
    collect(&root.join("src"), &mut files);
    files.sort();
    println!("cargo:rerun-if-changed=src");
    let mut hash = xxhash_rust::xxh3::Xxh3::new();
    for path in files {
        println!("cargo:rerun-if-changed={}", path.display());
        let bytes = std::fs::read(&path).expect("read dependency report input");
        let name = path
            .strip_prefix(&root)
            .expect("input under crate")
            .as_os_str()
            .as_encoded_bytes();
        for field in [name, bytes.as_slice()] {
            hash.update(
                &u64::try_from(field.len())
                    .expect("input fits u64")
                    .to_le_bytes(),
            );
            hash.update(field);
        }
    }
    println!(
        "cargo:rustc-env=NTS_DEPS_BUILD_HASH={:032x}",
        hash.digest128()
    );
}
