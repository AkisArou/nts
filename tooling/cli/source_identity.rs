// What a binary was built from: a digest of the files under its source roots
// (tooling/cli/source-roots.txt), exactly as they were on disk when it was
// built. Shared by the build scripts of `nts` (tooling/cli/build.rs) and
// `nts-bench` (tooling/bench/build.rs). tooling/bench/source-identity.ts
// computes the same digest from a commit, so a benchmark run can require both
// binaries to be that commit's sources, and a reader can check it afterwards.
// Plain comments, since build scripts `include!` this file.
//
// The digest is of content, not of HEAD: a commit that changes none of a
// binary's roots leaves its digest, and so its build, as they were. The
// script reruns when a file under a root changes, and when the roots do.
//
// Files: every path git tracks or would track (untracked, not ignored) under
// the roots that exists, in byte order. Each contributes its path, a NUL, the
// SHA-256 of its bytes in hex (a symbolic link's: its target), and a newline,
// after the line `nts-source-v1`.

fn source_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

fn source_roots(root: &std::path::Path, binary: &str) -> Vec<String> {
    let list = root.join("tooling/cli/source-roots.txt");
    println!("cargo:rerun-if-changed={}", list.display());
    let text = std::fs::read_to_string(&list).expect("reading the source roots");
    let line = text
        .lines()
        .find_map(|line| line.strip_prefix(binary)?.strip_prefix(':'))
        .unwrap_or_else(|| panic!("{} names no roots for {binary}", list.display()));
    line.split_whitespace().map(str::to_owned).collect()
}

fn source_files(root: &std::path::Path, roots: &[String]) -> Vec<String> {
    // An observation never refreshes the shared index (AGENTS.md, Your tree).
    let output = std::process::Command::new("git")
        .args([
            "--no-optional-locks",
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
        ])
        .args(roots)
        .current_dir(root)
        .output()
        .expect("listing the source files");
    assert!(output.status.success(), "git ls-files failed");
    let mut files: Vec<String> = String::from_utf8(output.stdout)
        .expect("UTF-8 source paths")
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect();
    files.sort();
    files.dedup();
    files
}

/// Sets `{prefix}_SOURCE_DIGEST` for the crate, from `binary`'s roots.
fn emit_source_identity(root: &std::path::Path, prefix: &str, binary: &str) {
    let roots = source_roots(root, binary);
    let mut digest = hmac_sha256::Hash::new();
    digest.update(b"nts-source-v1\n");
    for path in source_files(root, &roots) {
        let at = root.join(&path);
        let Ok(kind) = std::fs::symlink_metadata(&at) else {
            continue; // tracked, and deleted on disk: what was built lacks it
        };
        let bytes = if kind.file_type().is_symlink() {
            std::fs::read_link(&at)
                .expect("reading a source link")
                .into_os_string()
                .into_encoded_bytes()
        } else {
            std::fs::read(&at).expect("reading a source file")
        };
        let hex = source_hex(&hmac_sha256::Hash::hash(&bytes));
        digest.update(path.as_bytes());
        digest.update(b"\0");
        digest.update(hex.as_bytes());
        digest.update(b"\n");
    }
    let hex = source_hex(&digest.finalize());
    println!("cargo:rustc-env={prefix}_SOURCE_DIGEST={hex}");
    for path in &roots {
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
}
