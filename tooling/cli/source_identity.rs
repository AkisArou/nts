// The source a binary was built from: the commit, and whether the paths it
// is built from held uncommitted edits then. Shared by the build scripts of
// `nts` (tooling/cli/build.rs) and `nts-bench` (tooling/bench/build.rs), so
// that a benchmark row can require the `nts` that built its programs to be
// the source it records (tooling/bench/README.md, "Launch rows"). Plain
// comments, since build scripts `include!` this file.
//
// The script reruns when HEAD or a ref moves, and when any file
// under `paths` changes, so the dirty flag follows an edit and its commit.

fn source_git(root: &std::path::Path, args: &[&str]) -> String {
    // An observation never refreshes the shared index (AGENTS.md, Your tree).
    let output = std::process::Command::new("git")
        .arg("--no-optional-locks")
        .args(args)
        .current_dir(root)
        .output()
        .expect("git build identity");
    assert!(output.status.success(), "git build identity failed");
    String::from_utf8(output.stdout)
        .expect("UTF-8 git identity")
        .trim()
        .to_owned()
}

/// Sets `{prefix}_SOURCE_COMMIT` and `{prefix}_SOURCE_DIRTY` for the crate.
fn emit_source_identity(root: &std::path::Path, prefix: &str, paths: &[&str]) {
    let commit = source_git(root, &["rev-parse", "HEAD"]);
    println!("cargo:rustc-env={prefix}_SOURCE_COMMIT={commit}");
    let mut status = vec!["status", "--porcelain", "--untracked-files=no", "--"];
    status.extend_from_slice(paths);
    let dirty = source_git(root, &status);
    println!("cargo:rustc-env={prefix}_SOURCE_DIRTY={}", !dirty.is_empty());
    for path in ["HEAD", "packed-refs"] {
        let path = source_git(root, &["rev-parse", "--git-path", path]);
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
    let reference = std::process::Command::new("git")
        .args(["--no-optional-locks", "symbolic-ref", "-q", "HEAD"])
        .current_dir(root)
        .output()
        .expect("git branch identity");
    if reference.status.success() {
        let name = String::from_utf8(reference.stdout).expect("UTF-8 branch");
        let path = source_git(root, &["rev-parse", "--git-path", name.trim()]);
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
    for path in paths {
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
}
